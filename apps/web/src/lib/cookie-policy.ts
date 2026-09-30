export function cookieNames(production: boolean) {
  return {
    session: production ? '__Host-stockflow_session' : 'stockflow_session',
    organization: production ? '__Host-stockflow_organization' : 'stockflow_organization',
  };
}

export function privateCookieOptions(production: boolean) {
  return { httpOnly: true, secure: production, sameSite: 'lax', path: '/' } as const;
}
