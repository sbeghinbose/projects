const UPSTREAM = 'https://beghin-igcse-mcq-portal.decent-leaf-1314.chatgpt.site';

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin && origin !== incoming.origin) {
      return new Response(JSON.stringify({error:'Invalid origin'}), {status:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    const target = new URL(UPSTREAM);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.delete('Host');
    if (origin === incoming.origin) headers.set('Origin', UPSTREAM);
    const referrer = headers.get('Referer');
    if (referrer) {
      try { const url = new URL(referrer); if(url.origin === incoming.origin)headers.set('Referer', UPSTREAM + url.pathname + url.search); } catch {headers.delete('Referer');}
    }
    try {
      const response = await fetch(target, {
        method:request.method, headers,
        body:['GET','HEAD'].includes(request.method)?undefined:request.body,
        redirect:'manual',
      });
      const responseHeaders = new Headers(response.headers);
      const location = responseHeaders.get('Location');
      if(location) {
        const redirect = new URL(location, UPSTREAM);
        if(redirect.origin === UPSTREAM)responseHeaders.set('Location',incoming.origin + redirect.pathname + redirect.search + redirect.hash);
      }
      responseHeaders.set('Cache-Control','no-store');
      responseHeaders.set('X-Content-Type-Options','nosniff');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers:responseHeaders});
    } catch {
      return new Response('The exam portal is temporarily unavailable. Please try again.',{status:502,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
    }
  }
};
