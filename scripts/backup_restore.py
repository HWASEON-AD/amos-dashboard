# -*- coding: utf-8 -*-
"""
amos_posts / amos_daily_exposure 전체 백업 및 복원 스크립트.

백업:  python backup_restore.py backup
복원:  python backup_restore.py restore <백업파일경로>
검증:  python backup_restore.py verify <백업파일경로>

- 백업은 스크립트 기준 상대경로 ../backups/ 에 타임스탬프 파일로 저장한다.
- 복원은 백업 시점의 값으로 되돌린다(신규 행 삭제 + 기존 행 값 원복 + 노출기록 원복).
- 크로스플랫폼: 절대경로/사용자명 하드코딩 없음.
"""
import os, sys, json, re, io
from datetime import datetime
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
ENV  = os.path.join(BASE, '..', '.env.local')
BACKUP_DIR = os.path.join(BASE, '..', 'backups')

TABLES = ['amos_posts', 'amos_daily_exposure']


def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}")


def load_env():
    """`.env.local`에서 Supabase URL과 service role 키를 읽는다."""
    if not os.path.exists(ENV):
        print(f"오류: .env.local 없음 - {ENV}")
        sys.exit(1)
    txt = io.open(ENV, encoding='utf-8').read()
    env = dict(re.findall(r'^([A-Z_]+)=(.*)$', txt, re.M))
    url = env.get('NEXT_PUBLIC_SUPABASE_URL', '').strip()
    key = next((v.strip() for k, v in env.items() if 'SERVICE' in k), '')
    if not url or not key:
        print("오류: SUPABASE URL 또는 SERVICE 키를 .env.local에서 찾지 못함")
        sys.exit(1)
    return url, key


def req(url, key, path, method='GET', body=None, prefer=None):
    """Supabase REST 호출. 실패 시 원인을 출력하고 예외를 올린다."""
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key,
               'Content-Type': 'application/json'}
    if prefer:
        headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url + '/rest/v1/' + path, data=data,
                               headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as f:
            raw = f.read().decode()
            return json.loads(raw) if raw.strip() else []
    except urllib.error.HTTPError as e:
        print(f"오류: {method} {path} 실패 - HTTP {e.code} - {e.read().decode()[:300]}")
        raise


def fetch_all(url, key, table):
    """페이지네이션으로 테이블 전체를 가져온다 (PostgREST 기본 1000행 제한 회피)."""
    out, offset, page = [], 0, 1000
    while True:
        rows = req(url, key, f'{table}?select=*&limit={page}&offset={offset}')
        out.extend(rows)
        if len(rows) < page:
            break
        offset += page
    return out


def do_backup():
    url, key = load_env()
    os.makedirs(BACKUP_DIR, exist_ok=True)
    snap = {'taken_at': datetime.now().isoformat(), 'tables': {}}
    for t in TABLES:
        rows = fetch_all(url, key, t)
        snap['tables'][t] = rows
        log(f"{t}: {len(rows)}행 백업")
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(BACKUP_DIR, f'backup_{ts}.json')
    with io.open(path, 'w', encoding='utf-8') as f:
        json.dump(snap, f, ensure_ascii=False, indent=1)
    log(f"저장 완료: {os.path.abspath(path)}")
    return path


def do_verify(path):
    """백업 파일이 현재 DB와 일치하는지 대조한다."""
    url, key = load_env()
    snap = json.load(io.open(path, encoding='utf-8'))
    ok = True
    for t in TABLES:
        live = fetch_all(url, key, t)
        saved = snap['tables'][t]
        if len(live) != len(saved):
            log(f"불일치: {t} 현재 {len(live)}행 vs 백업 {len(saved)}행")
            ok = False
        else:
            log(f"일치: {t} {len(live)}행")
    print('검증 통과' if ok else '검증 실패')
    return ok


def do_restore(path):
    """백업 시점으로 되돌린다. 신규 행은 삭제하고, 기존 행은 값을 원복한다."""
    url, key = load_env()
    snap = json.load(io.open(path, encoding='utf-8'))

    # 1) amos_posts: 백업에 없는 id는 삭제, 있는 id는 값 원복
    saved = snap['tables']['amos_posts']
    saved_ids = {r['id'] for r in saved}
    live = fetch_all(url, key, 'amos_posts')
    extra = [r['id'] for r in live if r['id'] not in saved_ids]
    for pid in extra:
        req(url, key, f'amos_posts?id=eq.{pid}', method='DELETE')
    log(f"amos_posts 신규행 {len(extra)}건 삭제")

    for r in saved:
        body = {k: v for k, v in r.items() if k != 'id'}
        req(url, key, f"amos_posts?id=eq.{r['id']}", method='PATCH', body=body)
    log(f"amos_posts 기존 {len(saved)}행 값 원복")

    # 2) amos_daily_exposure: 전체 삭제 금지.
    #    백업 이후 새로 생긴 (post_id, date) 조합만 골라 삭제하고, 백업분은 upsert로 되살린다.
    #    (전체 DELETE 후 재삽입하면 복원 중 실패 시 기록이 소실되므로 절대 사용하지 않는다)
    exp = snap['tables']['amos_daily_exposure']
    saved_keys = {(r['post_id'], r['date']) for r in exp}
    live_exp = fetch_all(url, key, 'amos_daily_exposure')
    extra_exp = [r for r in live_exp if (r['post_id'], r['date']) not in saved_keys]
    for r in extra_exp:
        req(url, key,
            f"amos_daily_exposure?post_id=eq.{r['post_id']}&date=eq.{r['date']}",
            method='DELETE')
    log(f"amos_daily_exposure 백업 이후 추가분 {len(extra_exp)}건 삭제")

    if exp:
        req(url, key, 'amos_daily_exposure', method='POST', body=exp,
            prefer='resolution=merge-duplicates')
    log(f"amos_daily_exposure 백업분 {len(exp)}건 upsert 원복")

    # 3) 복원 결과 검증
    if do_verify(path):
        log("복원 완료 (검증 통과)")
    else:
        log("경고: 복원 후 검증 실패 — 백업 파일과 DB가 일치하지 않음")


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'backup'
    if cmd == 'backup':
        do_backup()
    elif cmd == 'verify':
        do_verify(sys.argv[2])
    elif cmd == 'restore':
        p = sys.argv[2]
        print(f"경고: {p} 시점으로 되돌립니다. 계속하려면 'RESTORE' 입력: ", end='')
        if input().strip() == 'RESTORE':
            do_restore(p)
        else:
            print("취소됨")
    else:
        print(__doc__)
