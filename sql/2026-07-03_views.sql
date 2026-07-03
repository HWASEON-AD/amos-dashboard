-- 카페/이미지호스팅 조회수 + 이미지호스팅URL 컬럼 추가 (additive, 파괴 없음)
-- Supabase SQL Editor에서 1회 실행

ALTER TABLE amos_posts ADD COLUMN IF NOT EXISTS image_host_url text;  -- 이미지호스팅URL (hwaseon-image.com)
ALTER TABLE amos_posts ADD COLUMN IF NOT EXISTS cafe_views integer;   -- 카페 조회수 (readCount, 새로고침으로 갱신·삭제시 유지)
ALTER TABLE amos_posts ADD COLUMN IF NOT EXISTS image_views integer;  -- 총 조회수 (hwaseon-image views)
