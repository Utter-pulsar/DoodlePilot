// The only three IPC channels in the app. Everything is routed by name through
// the query/command registries, so adding a feature never adds a channel.
export const IPC = {
  QUERY: 'dp:query',
  COMMAND: 'dp:command',
  EVENT: 'dp:event'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
