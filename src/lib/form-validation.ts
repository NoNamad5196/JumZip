import { z } from 'zod';

// Forms use Zod's interpreted validator under the public site's strict CSP.
// Configure this shared browser instance before declaring any form schemas.
z.config({ jitless: true });

export { z };
