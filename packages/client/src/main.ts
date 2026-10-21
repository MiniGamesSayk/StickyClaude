import './style.css';
import { startApp } from './app/app.ts';

startApp().catch((err: unknown) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.textContent = `Erreur au démarrage : ${err instanceof Error ? err.message : String(err)}`;
  pre.style.cssText = 'position:fixed;inset:20px;color:#900;white-space:pre-wrap';
  document.body.append(pre);
});
