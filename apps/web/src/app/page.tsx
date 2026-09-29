import {
  Activity,
  ArrowUpRight,
  Box,
  Check,
  CircleAlert,
  CodeXml,
  Database,
  Globe,
  Server,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { getApiHealth } from '@/lib/api-health';
import { RefreshButton } from './refresh-button';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const health = await getApiHealth();
  const checkedAt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(health.checkedAt));

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="StockFlow home">
          <span className="brand-mark">
            <Box size={23} strokeWidth={1.8} aria-hidden="true" />
          </span>
          StockFlow<span className="brand-period">.</span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-avatar">SF</span>
          <div>
            Development workspace<small>Foundation / v0.1.0</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <p className="nav-label">WORKSPACE</p>
          <Link href="/" className="nav-item" aria-current="page">
            <Activity size={18} aria-hidden="true" />
            System status
            <span className="nav-dot" />
          </Link>
        </nav>
        <div className="sidebar-footer">
          <CodeXml size={18} aria-hidden="true" />
          <div>
            StockFlow<small>Inventory & procurement</small>
          </div>
          <span className="version">0.1</span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div>
            Workspace <span>/</span> <strong>System status</strong>
          </div>
          <span className="environment">
            <span />
            Development
          </span>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">WORKSPACE HEALTH</p>
              <h1>System status</h1>
              <p className="last-checked">
                Last checked <time dateTime={health.checkedAt}>{checkedAt} UTC</time>
              </p>
            </div>
            <RefreshButton />
          </div>

          <section
            className={`status-banner ${health.connected ? 'is-connected' : 'is-unavailable'}`}
            aria-label="Connection status"
            aria-live="polite"
          >
            <span className="status-symbol">
              {health.connected ? (
                <Check size={23} aria-hidden="true" />
              ) : (
                <CircleAlert size={23} aria-hidden="true" />
              )}
            </span>
            <div>
              <h2>
                {health.connected ? 'Application services connected' : 'API connection unavailable'}
              </h2>
              <p>{health.connected ? 'Web application and API are responding.' : health.detail}</p>
            </div>
            <span className="status-tag">{health.connected ? '2 / 2 ONLINE' : '1 / 2 ONLINE'}</span>
          </section>

          <section className="services-section" aria-labelledby="services-title">
            <div className="section-heading">
              <h2 id="services-title">Application services</h2>
              <span>02 services</span>
            </div>
            <div className="service-table-wrapper">
              <table className="service-table">
                <thead>
                  <tr>
                    <th scope="col">SERVICE</th>
                    <th scope="col">STATUS</th>
                    <th scope="col">STACK</th>
                    <th scope="col">CHECK</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="service-name">
                        <span className="service-icon web-icon">
                          <Globe size={20} aria-hidden="true" />
                        </span>
                        <div>
                          Web application<small>stockflow / web</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge online">
                        <span />
                        Online
                      </span>
                    </td>
                    <td>Next.js</td>
                    <td>Page rendered</td>
                  </tr>
                  <tr>
                    <td>
                      <div className="service-name">
                        <span className="service-icon api-icon">
                          <Server size={20} aria-hidden="true" />
                        </span>
                        <div>
                          Backend API<small>stockflow / api</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${health.connected ? 'online' : 'offline'}`}>
                        <span />
                        {health.connected ? 'Online' : 'Unavailable'}
                      </span>
                    </td>
                    <td>NestJS</td>
                    <td>{health.connected ? `${health.durationMs} ms` : 'Failed'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="connection-section" aria-labelledby="connection-title">
            <div className="connection-description">
              <p className="eyebrow">LIVE CONNECTION</p>
              <h2 id="connection-title">API health check</h2>
              <div className="endpoint">
                <span>GET</span>
                <code>/api/health</code>
                <ArrowUpRight size={16} aria-hidden="true" />
              </div>
              <dl>
                <div>
                  <dt>Result</dt>
                  <dd>{health.connected ? 'Passed' : 'Failed'}</dd>
                </div>
                <div>
                  <dt>Round trip</dt>
                  <dd>{health.durationMs} ms</dd>
                </div>
                <div>
                  <dt>Cache</dt>
                  <dd>Disabled</dd>
                </div>
              </dl>
            </div>
            <div className="response-panel">
              <div className="response-heading">
                <span>
                  <span className={`response-dot ${health.connected ? '' : 'error-dot'}`} />
                  {health.connected ? 'Response body' : 'Connection error'}
                </span>
                <span>{health.connected ? 'JSON' : 'ERROR'}</span>
              </div>
              <pre aria-label="API response">
                <code>
                  {health.response ? JSON.stringify(health.response, null, 2) : health.detail}
                </code>
              </pre>
              <div className="response-footer">
                <ShieldCheck size={14} aria-hidden="true" />
                Liveness check
              </div>
            </div>
          </section>

          <section className="configuration" aria-label="Workspace configuration">
            <div>
              <Database size={18} aria-hidden="true" />
              <span>Database</span>
              <strong>Not configured</strong>
            </div>
            <div>
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Authentication</span>
              <strong>Not configured</strong>
            </div>
          </section>
          <footer className="page-footer">
            <span>STOCKFLOW</span>
            <span>
              Application foundation <span className="footer-divider">/</span> v0.1.0
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
