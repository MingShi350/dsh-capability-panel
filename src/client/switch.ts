import * as React from 'react';
import { Switch } from '@base-ui/react/switch';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import { TOK } from './styles.js';

export interface CapabilitySwitchOptions {
  readonly checked: boolean;
  readonly disabled: boolean;
  /** Dim the control while a write is in flight. */
  readonly busy: boolean;
  /** Accessible name; the caller translates it. */
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
  /**
   * Render at ~80% — the card foot's quieter size. The host Switch has no
   * size option of its own (a fixed 36×20 capsule), so the host rendition is
   * scaled as one piece: appearance and hit behavior stay the host's, only
   * the presentation shrinks. The legacy fallback renders its own smaller
   * geometry instead.
   */
  readonly small?: boolean;
}

/** The 0.1.7 design-system Switch, as far as this panel reads its props. */
interface HostSwitchProps {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly className?: string;
}
type HostSwitchComponent = (props: HostSwitchProps) => React.ReactElement;

/**
 * The capability switch, in one place for both panels.
 *
 * dsh 0.1.7 ships a design-system `Switch` (36×20 capsule, brand-primary on
 * state, its own disabled dimming and focus ring) — using it keeps the panel's
 * toggles pixel-identical to every settings page the host ships, which is the
 * alignment this file exists for. Hosts older than that export fall back to
 * the local Base UI rendition below, so one build still serves both
 * generations; the probe runs per call, the same way the icon table resolves.
 */
export function capabilitySwitch(options: CapabilitySwitchOptions): React.ReactElement {
  const inert = options.disabled || options.busy;
  const small = options.small === true;
  const HostSwitch = (primitives as unknown as { Switch?: HostSwitchComponent }).Switch;
  if (HostSwitch !== undefined) {
    const control = React.createElement(HostSwitch, {
      checked: options.checked,
      onChange: options.onCheckedChange,
      label: options.label,
      disabled: inert,
    });
    // The wrapper owns the shrunken layout box (36×20 → 29×16) so the scale
    // leaves no phantom spacing; the transform centers the capsule inside it.
    return small
      ? React.createElement('span', { className: 'ci-switch-sm' }, control)
      : control;
  }
  const geometry = small
    ? { track: { width: '28px', height: '16px' }, thumb: { size: '12px', offset: '12px' } }
    : { track: { width: '32px', height: '18px' }, thumb: { size: '14px', offset: '14px' } };
  return React.createElement(
    Switch.Root,
    {
      className: 'ci-switch',
      checked: options.checked,
      disabled: inert,
      'aria-label': options.label,
      onCheckedChange: options.onCheckedChange,
      style: {
        position: 'relative',
        width: geometry.track.width,
        height: geometry.track.height,
        padding: 0,
        border: 'none',
        borderRadius: '999px',
        background: options.checked ? TOK.switchOn : TOK.switchOff,
        cursor: inert ? 'not-allowed' : 'pointer',
        opacity: options.busy ? 0.65 : 1,
        flex: '0 0 auto',
      },
    },
    React.createElement(Switch.Thumb, {
      className: 'ci-thumb',
      style: {
        display: 'block',
        width: geometry.thumb.size,
        height: geometry.thumb.size,
        margin: '2px',
        borderRadius: '999px',
        background: TOK.switchThumb,
        boxShadow: '0 1px 2px rgba(0,0,0,.22)',
        transform: options.checked ? `translateX(${geometry.thumb.offset})` : 'translateX(0)',
        transition: `transform .12s ${TOK.switchEase}`,
      },
    }),
  );
}