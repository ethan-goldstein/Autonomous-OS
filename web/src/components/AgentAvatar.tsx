import type { AgentStatus } from '../types';

const GLYPH: Record<string, string> = {
  mail: '✉',
  wallet: '$',
  trending: '▲',
  leads: '◎',
  brief: '★',
  pure: '✦',
  services: '▰',
  marketplace: '❋',
  video: '♪',
  core: '◆',
};

// Circular logo: green ring when active/live, red when off (error).
export function AgentAvatar({
  icon,
  status,
  size = 60,
}: {
  icon: string;
  status: AgentStatus;
  size?: number;
}) {
  const off = status === 'error';
  const busy = status === 'working';
  return (
    <div
      className={`avatar ${off ? 'avatar-off' : 'avatar-on'} ${busy ? 'avatar-busy' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      <span className="avatar-glyph">{GLYPH[icon] || '◉'}</span>
      <span className="avatar-led" />
    </div>
  );
}
