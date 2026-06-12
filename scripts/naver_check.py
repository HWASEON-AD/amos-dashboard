# -*- coding: utf-8 -*-
"""
naver_check.py
매일 오후 4시(KST) GitHub Actions에서 자동 실행.
Supabase amos_posts에서 '노출중' 키워드를 읽어
네이버 모바일 검색으로 발행URL 노출 여부를 확인하고
amos_daily_exposure에 기록한다.
"""

import os
import sys
import time
import re
import urllib.parse
from datetime import date, datetime

import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from PIL import Image, ImageDraw, ImageFont
import io

# ── 환경 변수 ──────────────────────────────────────────────────
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://kepzsboxjulzygehmzpf.supabase.co')
SUPABASE_KEY = os.environ['SUPABASE_SERVICE_KEY']
TODAY = date.today().isoformat()

SB_HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
}

# 모바일 에뮬레이션 (iPhone)
MOBILE_EMULATION = {
    "deviceMetrics": {"width": 390, "height": 844, "pixelRatio": 3.0},
    "userAgent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Version/16.0 Mobile/15E148 Safari/604.1"
    ),
}


def log(msg: str):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


# ── Supabase 연동 ──────────────────────────────────────────────

def get_posts() -> list[dict]:
    """blog_url 있는 포스트 전체 조회 (상태 무관)"""
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/amos_posts'
        '?select=id,keyword,blog_url,tab_type,brand,product,hwaseon_url'
        '&blog_url=not.is.null',
        headers=SB_HEADERS,
        timeout=10
    )
    if not r.ok:
        log(f"포스트 조회 실패: {r.status_code} {r.text}")
        return []
    return r.json()


def save_exposure(post_id: str, is_exposed: bool):
    """노출된 경우만 amos_daily_exposure에 INSERT, 상태도 업데이트"""
    # 노출 기록 (row 존재 = 노출, is_exposed 컬럼 없음)
    if is_exposed:
        r = requests.post(
            f'{SUPABASE_URL}/rest/v1/amos_daily_exposure',
            headers={**SB_HEADERS, 'Prefer': 'resolution=ignore-duplicates'},
            json={'post_id': post_id, 'date': TODAY},
            timeout=10
        )
        if not r.ok:
            log(f"  노출기록 저장 실패: {r.status_code}")
    # amos_posts 상태 업데이트
    new_status = '노출중' if is_exposed else '미노출'
    requests.patch(
        f'{SUPABASE_URL}/rest/v1/amos_posts?id=eq.{post_id}',
        headers=SB_HEADERS,
        json={'status': new_status},
        timeout=10
    )


def upload_screenshot(post_id: str, img_bytes: bytes) -> str | None:
    """Supabase Storage 'amos-captures'에 업로드, 성공 시 public URL 반환"""
    path = f'captures/{TODAY}/{post_id}.png'
    r = requests.post(
        f'{SUPABASE_URL}/storage/v1/object/amos-captures/{path}',
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'image/png',
            'x-upsert': 'true',
        },
        data=img_bytes,
        timeout=15
    )
    if r.ok:
        return f'{SUPABASE_URL}/storage/v1/object/public/amos-captures/{path}'
    return None


def save_capture(post_id: str, brand: str | None, keyword: str, product: str | None, image_url: str):
    """amos_daily_captures에 노출 캡처 저장 (upsert — post_id+date 충돌 시 image_url 덮어쓰기)"""
    r = requests.post(
        f'{SUPABASE_URL}/rest/v1/amos_daily_captures?on_conflict=post_id,date',
        headers={**SB_HEADERS, 'Prefer': 'resolution=merge-duplicates'},
        json={
            'post_id': post_id,
            'date': TODAY,
            'brand': brand,
            'keyword': keyword,
            'product': product,
            'image_url': image_url,
        },
        timeout=10
    )
    if not r.ok:
        log(f"  캡처 DB 저장 실패: {r.status_code} {r.text[:80]}")


# ── Selenium 드라이버 ──────────────────────────────────────────

def create_driver():
    """Headless Chrome 드라이버 생성 (GitHub Actions 호환)"""
    options = webdriver.ChromeOptions()
    options.add_experimental_option("mobileEmulation", MOBILE_EMULATION)
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--window-size=390,844")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    driver = webdriver.Chrome(options=options)  # selenium-manager가 chromedriver 자동 관리
    driver.set_page_load_timeout(15)
    return driver


# ── URL 파싱 ───────────────────────────────────────────────────

def parse_url(url: str) -> dict:
    """blog/cafe URL에서 post_no, blog_id 추출"""
    result = {"type": "unknown", "id": "", "post_no": ""}
    if not url:
        return result
    n = url.replace("m.blog.naver.com", "blog.naver.com").replace("m.cafe.naver.com", "cafe.naver.com")
    m = re.search(r"blog\.naver\.com/([^/?#]+)/(\d+)", n)
    if m:
        return {"type": "blog", "id": m.group(1), "post_no": m.group(2)}
    m = re.search(r"cafe\.naver\.com/([^/?#]+)/(\d+)", n)
    if m:
        return {"type": "cafe", "id": m.group(1), "post_no": m.group(2)}
    return result


# ── 캡처 이미지 생성 ───────────────────────────────────────────

def _load_font(size: int = 16):
    """OS별 한국어 폰트 로드 (없으면 기본 폰트)"""
    paths = [
        "C:/Windows/Fonts/malgun.ttf",
        "C:/Windows/Fonts/malgunbd.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJKkr-Regular.otf",
    ]
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def find_section(link_element, driver):
    """링크 엘리먼트의 상위 섹션 컨테이너 탐색 (api_subject_bx → _fe_r → section 순)"""
    xpaths = [
        "ancestor::div[contains(@class,'api_subject_bx')][1]",
        "ancestor::div[contains(@class,'_fe_r')][1]",
        "ancestor::section[1]",
    ]
    for xp in xpaths:
        try:
            el = link_element.find_element(By.XPATH, xp)
            if el:
                return el
        except Exception:
            continue
    return None


def make_capture_bytes(driver, link_element, section_element, keyword: str) -> bytes | None:
    """섹션 크롭 + 키워드 텍스트 상단 오버레이 + 빨간 테두리 적용 이미지 반환"""
    try:
        target = section_element or link_element
        driver.execute_script("arguments[0].scrollIntoView({block:'center'})", target)
        time.sleep(0.5)

        screenshot = driver.get_screenshot_as_png()
        img = Image.open(io.BytesIO(screenshot))

        # 섹션 bounding box로 크롭
        if section_element:
            rect = driver.execute_script(
                "return arguments[0].getBoundingClientRect();", section_element
            )
            top = max(0, int(rect["y"]) - 8)
            bottom = min(img.height, int(rect["y"] + rect["height"]) + 16)
            right = img.width
            if bottom > top:
                img = img.crop((0, top, right, bottom))

        w, h = img.size
        draw = ImageDraw.Draw(img)
        font = _load_font(16)

        # 상단 다크 배경 + 키워드 텍스트
        text_h = 30
        draw.rectangle([0, 0, w, text_h], fill=(30, 30, 30))
        draw.text((8, 7), keyword, fill=(255, 255, 255), font=font)

        # 빨간 테두리 (텍스트 영역 아래부터)
        border = 3
        draw.rectangle(
            [border, text_h + border, w - border - 1, h - border - 1],
            outline=(255, 0, 0), width=border
        )

        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()
    except Exception as e:
        log(f"  캡처 이미지 생성 오류: {str(e)[:60]}")
        try:
            return driver.get_screenshot_as_png()
        except Exception:
            return None


# ── 노출 확인 ──────────────────────────────────────────────────

def check_exposed(driver, keyword: str, blog_url: str) -> tuple[bool, bytes | None]:
    """네이버 모바일 검색 → URL 매칭 → 노출 여부 + 크롭+오버레이 캡처 반환"""
    try:
        driver.get(f"https://m.search.naver.com/search.naver?query={urllib.parse.quote(keyword)}")
        time.sleep(2)
    except Exception as e:
        log(f"  검색 실패: {e}")
        return False, None

    parsed = parse_url(blog_url)
    post_no = parsed["post_no"]
    blog_id = parsed["id"]
    if not post_no:
        return False, None

    found_link = None
    for _ in range(4):
        links = driver.find_elements(By.TAG_NAME, "a")
        for link in links:
            try:
                href = (link.get_attribute("href") or "")
                href = href.replace("m.blog.naver.com", "blog.naver.com").replace("m.cafe.naver.com", "cafe.naver.com")
                if post_no in href and (not blog_id or blog_id in href):
                    found_link = link
                    break
            except Exception:
                continue
        if found_link:
            break
        driver.execute_script("window.scrollBy(0, 1200)")
        time.sleep(1.5)

    if not found_link:
        return False, None

    # 섹션 탐색 → 크롭+오버레이 캡처
    section = find_section(found_link, driver)
    img_bytes = make_capture_bytes(driver, found_link, section, keyword)

    return True, img_bytes


# ── hwaseon-image 트래킹 ──────────────────────────────────────

HWASEON_IMAGE_BASE = 'https://hwaseon-image.com'

def extract_hwaseon_image_ids(html: str) -> list:
    """HTML에서 hwaseon-image.com 이미지 ID 추출 (3가지 패턴)"""
    found = set()
    # 패턴1: /image/<id>
    for m in re.finditer(r'https?://hwaseon-image\.com/image/([a-zA-Z0-9_\-]+)', html):
        found.add(m.group(1))
    # 패턴2: /uploads/<id>.<ext>
    for m in re.finditer(r'https?://hwaseon-image\.com/uploads/([a-zA-Z0-9_\-]+)\.[a-zA-Z]{2,5}', html):
        found.add(m.group(1))
    # 패턴3: URL 인코딩된 경우 (네이버 이미지 프록시)
    for m in re.finditer(r'hwaseon-image\.com(?:%2F|/)(?:image|uploads)(?:%2F|/)([a-zA-Z0-9_\-]+)', html):
        found.add(m.group(1))
    return list(found)


def get_hwaseon_image_views(image_id: str) -> int | None:
    """hwaseon-image.com /image/:id/detail API로 조회수 가져오기 (인증 불필요)"""
    try:
        r = requests.get(
            f'{HWASEON_IMAGE_BASE}/image/{image_id}/detail',
            timeout=10
        )
        if r.ok:
            return r.json().get('views', 0)
    except Exception as e:
        log(f"  hwaseon-image API 오류: {str(e)[:60]}")
    return None


def get_views_from_hwaseon_url(hwaseon_url: str) -> int | None:
    """제품링크URL 방문 → hwaseon-image ID 추출 → 조회수 반환. 없으면 None."""
    if not hwaseon_url:
        return None
    try:
        headers = {
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            )
        }
        # allow_redirects=True 로 단축URL 리다이렉트 자동 처리
        r = requests.get(hwaseon_url, headers=headers, timeout=15, allow_redirects=True)
        if not r.ok:
            log(f"  제품링크 fetch 실패: {r.status_code}")
            return None

        html = r.text
        ids = extract_hwaseon_image_ids(html)
        if not ids:
            log(f"  hwaseon-image 미발견 (URL-encoded 시도)")
            # URL 디코딩 후 재시도
            decoded = urllib.parse.unquote(html)
            ids = extract_hwaseon_image_ids(decoded)

        if not ids:
            log(f"  hwaseon-image 없음 → 조회수 트래킹 불가")
            return None

        image_id = ids[0]
        views = get_hwaseon_image_views(image_id)
        log(f"  hwaseon-image id={image_id} → 조회수 {views}")
        return views
    except Exception as e:
        log(f"  제품링크 접근 오류: {str(e)[:60]}")
        return None


# ── 카페 조회수 스크래핑 ────────────────────────────────────────

def get_cafe_view_count(driver, blog_url: str) -> int | None:
    """카페 포스트 실제 조회수 스크래핑"""
    parsed = parse_url(blog_url)
    if parsed['type'] != 'cafe':
        return None
    try:
        driver.get(blog_url.replace('m.cafe.naver.com', 'cafe.naver.com'))
        time.sleep(2)
        html = driver.page_source
        # 카페 조회수 패턴 (조회 N, 읽음 N 등)
        m = re.search(r'조회\s*[:|]?\s*([\d,]+)', html)
        if m:
            return int(m.group(1).replace(',', ''))
        m = re.search(r'"readCount"\s*:\s*(\d+)', html)
        if m:
            return int(m.group(1))
    except Exception as e:
        log(f"  카페 조회수 오류: {str(e)[:40]}")
    return None


def save_view_count(post_id: str, count: int):
    """amos_posts.total_views 업데이트"""
    requests.patch(
        f'{SUPABASE_URL}/rest/v1/amos_posts?id=eq.{post_id}',
        headers=SB_HEADERS,
        json={'total_views': count},
        timeout=10
    )


# ── 메인 ───────────────────────────────────────────────────────

def main():
    posts = get_posts()
    log(f"체크 시작: {TODAY} / 총 {len(posts)}개")

    if not posts:
        log("체크할 포스트 없음 (노출중 + blog_url 있는 항목 0개)")
        return

    os.makedirs("captures", exist_ok=True)
    driver = create_driver()
    results = []

    try:
        for i, post in enumerate(posts):
            kw = post['keyword']
            url = post['blog_url']
            post_id = post['id']
            log(f"[{i+1}/{len(posts)}] {kw}")

            try:
                is_exposed, img_bytes = check_exposed(driver, kw, url)
            except Exception as e:
                log(f"  오류: {e}")
                is_exposed, img_bytes = False, None

            save_exposure(post_id, is_exposed)

            # hwaseon-image 조회수 트래킹 (제품링크URL이 있으면)
            hwaseon_url = post.get('hwaseon_url')
            if hwaseon_url:
                views = get_views_from_hwaseon_url(hwaseon_url)
                if views is not None:
                    save_view_count(post_id, views)

            # 카페 글이면 조회수 추가 수집 (hwaseon-image 없을 경우 fallback)
            parsed = parse_url(url)
            if parsed['type'] == 'cafe' and not hwaseon_url:
                view_count = get_cafe_view_count(driver, url)
                if view_count is not None:
                    save_view_count(post_id, view_count)
                    log(f"  카페 조회수: {view_count}")

            # 노출된 경우에만 캡처 저장
            if is_exposed and img_bytes:
                image_url = upload_screenshot(post_id, img_bytes)
                if image_url:
                    save_capture(
                        post_id=post_id,
                        brand=post.get('brand'),
                        keyword=kw,
                        product=post.get('product'),
                        image_url=image_url
                    )
                else:
                    fname = re.sub(r'[\\/:*?"<>|]', '_', kw)
                    with open(f'captures/{fname}.png', 'wb') as f:
                        f.write(img_bytes)

            results.append({'keyword': kw, 'exposed': is_exposed})
            log(f"  -> {'O 노출중' if is_exposed else 'X 미노출'}")
            time.sleep(1)
    finally:
        driver.quit()

    exposed = sum(1 for r in results if r['exposed'])
    log(f"\n완료: {exposed}/{len(results)} 노출 확인")
    print("\n=== 체크 결과 ===")
    for r in results:
        mark = 'O' if r['exposed'] else 'X'
        kw = r['keyword'].encode('utf-8', errors='replace').decode('utf-8')
        print(f"{mark} {kw}")


if __name__ == '__main__':
    main()
