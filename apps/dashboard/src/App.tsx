import { Home } from './pages/Home';
import { Live } from './pages/Live';
import { GeneralReportPage, PilotReportPage } from './pages/Reports';
import { usePath } from './lib/router';
import { useTheme } from './lib/theme';

export function App() {
  const path = usePath();
  const [theme, toggleTheme] = useTheme();
  const common = { theme, toggleTheme };

  let m = path.match(/^\/s\/([A-Za-z0-9]+)\/pilot\/([^/]+)\/?$/);
  if (m) return <PilotReportPage code={m[1].toUpperCase()} pilotId={m[2]} {...common} />;
  m = path.match(/^\/s\/([A-Za-z0-9]+)\/report\/?$/);
  if (m) return <GeneralReportPage code={m[1].toUpperCase()} {...common} />;
  m = path.match(/^\/s\/([A-Za-z0-9]+)\/?$/);
  if (m) return <Live key={m[1]} code={m[1].toUpperCase()} {...common} />;
  return <Home {...common} />;
}
