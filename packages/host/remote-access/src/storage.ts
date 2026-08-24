import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const deviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  firstConnectedAt: z.number().int().nonnegative(),
  lastConnectedAt: z.number().int().nonnegative(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
})

export const REMOTE_ACCESS_DOMAIN = defineDomain({
  name: 'deepcreator_remote_access',
  version: 1,
  global: {
    schema: z.object({ hostId: z.string() }),
    initial: { hostId: '' },
  },
  tables: {
    devices: domainTable<string, z.infer<typeof deviceSchema>>(deviceSchema),
  },
})

export type RemoteAccessDomain = Domain<typeof REMOTE_ACCESS_DOMAIN>
