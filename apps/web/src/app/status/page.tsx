import { Check, CircleAlert, Database, Globe, Server, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { getApiHealth, isDatabaseReady } from '@/lib/api-health';
import { currentUser } from '@/lib/session';
import { RefreshButton } from '../refresh-button';

export const metadata = { title: 'System status' };
export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const [health, databaseReady, account] = await Promise.all([
    getApiHealth(),
    isDatabaseReady(),
    currentUser(),
  ]);
  const connected = health.connected && databaseReady;
  const statusTitle = !health.connected
    ? 'API connection unavailable'
    : !databaseReady
      ? 'Database connection unavailable'
      : 'Application services connected';
  const checkedAt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(health.checkedAt));
  const services = [
    {
      name: 'Web application',
      detail: 'stockflow / web',
      icon: Globe,
      online: true,
      status: 'Online',
      stack: 'Next.js',
      check: 'Page rendered',
    },
    {
      name: 'Backend API',
      detail: 'stockflow / api',
      icon: Server,
      online: health.connected,
      status: health.connected ? 'Online' : 'Unavailable',
      stack: 'NestJS',
      check: health.connected ? `${health.durationMs} ms` : 'Failed',
    },
    {
      name: 'Database',
      detail: 'Readiness query',
      icon: Database,
      online: databaseReady,
      status: databaseReady ? 'Connected' : 'Unavailable',
      stack: 'PostgreSQL',
      check: databaseReady ? 'Query passed' : 'Failed',
    },
  ];
  return (
    <AppShell user={account.ok ? account.data : undefined} section="System status">
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
        className={`status-banner ${connected ? 'is-connected' : 'is-unavailable'}`}
        aria-label="Connection status"
        aria-live="polite"
      >
        <span className="status-symbol">
          {connected ? (
            <Check size={23} aria-hidden="true" />
          ) : (
            <CircleAlert size={23} aria-hidden="true" />
          )}
        </span>
        <div>
          <h2>{statusTitle}</h2>
          <p>
            {connected
              ? 'Web application, API, and database are responding.'
              : health.connected
                ? 'The API is online, but database readiness could not be confirmed.'
                : health.detail}
          </p>
        </div>
        <span className="status-tag">
          {1 + Number(health.connected) + Number(databaseReady)} / 3 ONLINE
        </span>
      </section>
      <section className="services-section" aria-labelledby="services-title">
        <div className="section-heading">
          <h2 id="services-title">Application services</h2>
          <span>03 services</span>
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
              {services.map((service) => (
                <tr key={service.name}>
                  <td>
                    <div className="service-name">
                      <span
                        className={`service-icon ${service.stack === 'NestJS' ? 'api-icon' : 'web-icon'}`}
                      >
                        <service.icon size={20} aria-hidden="true" />
                      </span>
                      <div>
                        {service.name}
                        <small>{service.detail}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${service.online ? 'online' : 'offline'}`}>
                      <span />
                      {service.status}
                    </span>
                  </td>
                  <td>{service.stack}</td>
                  <td>{service.check}</td>
                </tr>
              ))}
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
            <span>{health.connected ? 'Response body' : 'Connection error'}</span>
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
    </AppShell>
  );
}
