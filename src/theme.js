// Палитра MaintAR: единый источник цветов.
// Отсюда её берёт tailwind.config.js (классы bg-primary, text-defect и т.д.)
// и код, которому нужен цвет значением (иконки, индикаторы, плейсхолдеры).
const colors = {
  primary: '#0b5c7a',
  'primary-soft': '#e1eef3',
  bg: '#eef2f5',
  surface: '#ffffff',
  sunken: '#e6ecf0',
  line: '#d5dde3',
  divider: '#e8edf1',
  fg: '#12202b',
  muted: '#5b6b78',
  faint: '#8a98a3',
  ok: '#1f7a4d',
  'ok-bg': '#dcefe4',
  check: '#9a5b00',
  'check-bg': '#fbe9c8',
  defect: '#b3261e',
  'defect-bg': '#f9dcd9',
};

module.exports = { colors };
