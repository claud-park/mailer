/** 라벨에 색이 없을 때 칩 배경으로 쓰는 테마별 중립색 (`${hex}33` 알파 합성에 쓰이므로 hex여야 함) */
export function labelChipFallback(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? '#2a2a2a' : '#e4e4e7';
}
