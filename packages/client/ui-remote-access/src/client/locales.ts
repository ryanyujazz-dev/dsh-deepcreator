export const zh = {
  nav: '远程', title: '远程', intro: '通过同一 Wi‑Fi 在手机上使用当前 DeepCreator。',
  disabled: '远程访问已关闭。', enabled: '远程访问已开启', enable: '开启远程访问', disable: '关闭远程访问',
  starting: '正在更新…', connection: '连接手机', scan: '使用手机扫描二维码，并在桌面端核对六位验证码。无需安装证书。',
  expires: '二维码将在两分钟后失效。', addresses: '局域网地址',
  requests: '待确认设备', approve: '允许', reject: '拒绝', devices: '已配对设备', noDevices: '尚无已配对设备。',
  revoke: '撤销', revokeAll: '撤销全部设备', firstConnected: '首次连接', lastConnected: '最近连接',
  loadError: '无法读取远程访问状态。', retry: '重试', actionError: '操作失败',
  remoteTitle: '当前连接', remoteIntro: '此页面正在使用桌面端提供的局域网连接。',
  trustedNetworkWarning: '连接未加密。请仅在你信任的家庭或私人 Wi‑Fi 中使用，不要暴露到公共网络或互联网。',
  transport: '连接方式', httpTransport: 'HTTP（未加密）',
  host: '桌面端', device: '本设备', disconnect: '断开此浏览器', disconnected: '连接已断开。',
} satisfies Record<string, string>
export type RemoteKey = keyof typeof zh
export const en = {
  nav: 'Remote', title: 'Remote', intro: 'Use this DeepCreator from a phone on the same Wi-Fi.',
  disabled: 'Remote access is off.', enabled: 'Remote access is on', enable: 'Enable remote access', disable: 'Disable remote access',
  starting: 'Updating…', connection: 'Connect phone', scan: 'Scan with your phone, then verify the six-digit code on the desktop. No certificate installation is required.',
  expires: 'The QR code expires in two minutes.', addresses: 'LAN addresses',
  requests: 'Pending devices', approve: 'Allow', reject: 'Reject', devices: 'Paired devices', noDevices: 'No paired devices yet.',
  revoke: 'Revoke', revokeAll: 'Revoke all devices', firstConnected: 'First connected', lastConnected: 'Last connected',
  loadError: 'Remote access status is unavailable.', retry: 'Retry', actionError: 'Action failed',
  remoteTitle: 'Current connection', remoteIntro: 'This page is using the LAN connection provided by the desktop app.',
  trustedNetworkWarning: 'This connection is not encrypted. Use it only on a trusted home or private Wi-Fi network; never expose it to public networks or the internet.',
  transport: 'Transport', httpTransport: 'HTTP (not encrypted)',
  host: 'Desktop', device: 'This device', disconnect: 'Disconnect this browser', disconnected: 'Connection disconnected.',
} satisfies Record<RemoteKey, string>
