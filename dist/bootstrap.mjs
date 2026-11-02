import { groups, specs } from './navigation.mjs';
import { dailyLayout } from './daily-layout.mjs';
const mode = document.querySelector('meta[name="studio-data-mode"]')?.content;
if (mode === 'cloud-readonly') {
  await import('./cloud-view.mjs');
} else {
  window.StudioNavigation = { groups, specs };
  document.querySelector('#page-daily').innerHTML = dailyLayout;
  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  try {
    await load('./app.js');
    await load('./ops.js');
  } catch {
    document.querySelector('#task-list').textContent = '页面资源加载失败，请刷新后重试。';
  }
}
