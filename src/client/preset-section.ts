import * as React from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { Input } from '@base-ui/react/input';
import { Tabs } from '@base-ui/react/tabs';
// Same host-graph discipline as the composer panel: the Menu primitive keeps
// the picker's popup on the theme tokens a native <select> can never reach.
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
// Icon names differ across host generations; icons.ts resolves whichever exists.
import { IconChevronDown, IconFolderClose, IconRefresh, IconSearch } from './icons.js';
import { resolveDisclosure } from './disclosure.js';
import { disclosureRow } from './disclosure-row.js';
import { toolRowIcon } from './row-icon.js';
import { capabilitySwitch } from './switch.js';
import { filterPreset } from './preset-filter.js';
import type { FilteredPreset } from './preset-filter.js';
import {
  getPresetToolsSnapshot,
  loadPresetTools,
  reconnectPresetServer,
  selectPreset,
  setPresetServer,
  setPresetSkill,
  setPresetTool,
  subscribePresetTools,
} from './preset-store.js';
import type { PresetMcpView, PresetSkillView, PresetToolView } from './preset-store.js';
import type { Translate } from './locale.js';
import { TOK } from './styles.js';

export interface PresetToolSectionProps {
  readonly t: Translate;
  readonly subscribeLocale: (listener: () => void) => () => void;
  readonly getLocaleSnapshot: () => { readonly active: string; readonly revision: number };
}

/** The category the kind switcher narrows to; `all` shows every part. */
type SegmentedKind = 'all' | 'skills' | 'mcp' | 'system';

/** The 0.1.7 design-system SegmentedControl, as far as this panel reads it. */
type SegmentedControlComponent = (props: {
  id: string;
  value: SegmentedKind;
  options: readonly { value: SegmentedKind; label: string; disabled?: boolean; title?: string }[];
  onChange: (next: SegmentedKind) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) => React.ReactElement;

/** Middle ellipsis for long path labels; the full path stays in the tooltip. */
const ellipsizeMiddle = (text: string, max = 56): string => {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
};

/** Group items by a key, preserving first-seen order. */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket !== undefined) bucket.push(item);
    else { groups.set(key, [item]); order.push(key); }
  }
  return order.map((key) => [key, groups.get(key)!]);
}

/**
 * Open a source folder from the settings page. The route resolves
 * user/project/host/preset sources without a session (project sources
 * against the dsh process's own cwd, matching how this page lists them).
 */
function openSourceFolder(source: string): void {
  void fetch('/api/capability-panel/open-folder', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source }),
  }).then((response) => {
    if (!response.ok) console.warn(`[capability-panel] cannot open source folder (${response.status})`);
  }).catch((error: unknown) => {
    console.warn('[capability-panel] open source folder request failed', error);
  });
}

/** Sources the open-folder route can resolve without a session. */
const SESSIONLESS_OPENABLE = new Set(['user-dsh', 'user-agents', 'project-dsh', 'project-agents', 'host']);

/** Expand/collapse label, worded like the composer panel's. */
function detailAria(t: Translate, subject: string, open: boolean, disabled: boolean): string {
  const detail = t('detail.description');
  if (disabled) return t('disclosure.pinned', { subject, detail });
  return t(open ? 'disclosure.collapse' : 'disclosure.expand', { subject, detail });
}

/**
 * A ruled source divider between card groups — the same visual language as
 * the session panel's group headers (`── label (count) ────`), spanning the
 * full grid width. Preset groups name their preset; other groups show the
 * directory (ellipsized); openable groups offer the hover folder icon and a
 * click-through.
 */
function SourceDivider(props: {
  readonly t: Translate;
  readonly groupKey: string;
  readonly items: readonly { path?: string; source?: string }[];
  readonly first: boolean;
}): React.ReactElement {
  const { t, groupKey, items, first } = props;
  const presetName = groupKey.startsWith('preset:') ? groupKey.slice(7) : undefined;
  const pathGroup = groupKey.startsWith('path:');
  const path = items.find((item) => item.path !== undefined)?.path;
  // Unknown or untranslated group keys display as-is, never the raw
  // `source.*` locale key (the session panel falls back the same way).
  const translated = t(`source.${groupKey}`);
  const fallbackLabel = translated === `source.${groupKey}` ? groupKey : translated;
  const label = presetName ?? (path !== undefined ? ellipsizeMiddle(path) : pathGroup ? groupKey.slice(5) : groupKey === 'host' ? t('source.host') : fallbackLabel);
  // `path:` groups send their key verbatim: it carries the raw discovery
  // root, and the route re-validates it against a fresh listing before
  // opening — resolving by the row's coarse runtime source would open the
  // first directory that shares it, not necessarily this one.
  const openSource = presetName ?? groupKey;
  const openable = presetName !== undefined || pathGroup || SESSIONLESS_OPENABLE.has(groupKey);
  const rule = (grow: boolean): React.ReactElement =>
    React.createElement('span', {
      style: grow
        ? { flex: '1', height: '1px', background: TOK.borderStrong }
        : { flex: 'none', width: '16px', height: '1px', background: TOK.borderStrong },
    });
  return React.createElement(
    'li',
    { className: 'ci-source-divider' },
    React.createElement(
      'div',
      {
        className: 'ci-source-header',
        style: { display: 'flex', alignItems: 'center', gap: '8px', margin: first ? '6px 0 2px' : '18px 0 2px' },
      },
      rule(false),
      React.createElement(
        'span',
        {
          style: {
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px',
            fontWeight: 500,
            color: TOK.textTertiary,
            fontVariantNumeric: 'tabular-nums',
            cursor: openable ? 'pointer' : 'default',
          },
          title: openable ? t('source.openFolder', { source: path ?? label }) : undefined,
          onClick: openable ? () => { openSourceFolder(openSource); } : undefined,
        },
        openable
          ? React.createElement(
              'span',
              { className: 'ci-folder-icon', style: { display: 'inline-grid', placeItems: 'center', opacity: 0, transition: 'opacity 0.15s' } },
              // The host's own folder glyph, same as the session panel's dividers.
              React.createElement(IconFolderClose, { size: 14 }),
            )
          : null,
        `${label} (${items.length})`,
      ),
      rule(true),
    ),
  );
}

/** One switch, shared by tool cards, server cards and skill cards. */
function CapabilitySwitch(props: {
  readonly on: boolean;
  readonly frozen: boolean;
  readonly locked: boolean;
  readonly busy: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}): React.ReactElement {
  return capabilitySwitch({
    checked: props.on,
    disabled: props.locked || props.frozen,
    busy: props.busy,
    label: props.label,
    onCheckedChange: props.onChange,
  });
}

/** One row of the details footer's fact grid, the host plugin card's dt/dd. */
interface CardFact {
  readonly label: string;
  readonly value: React.ReactNode;
}

/**
 * One capability card, measured off the host's plugin-inventory card: a
 * framed box whose head row carries the title (medium weight, ellipsis)
 * and a trailing cluster — switch first, then a chevron that ROTATES on
 * open. The description previews clamped at two lines and simply unclamps
 * while the card is open; the details footer is a tinted panel of facts.
 * The switch stays OUTSIDE the expand gesture so the two never compete.
 *
 * `framed: false` renders the same content as a plain disclosure row —
 * nested tools inside a server card, where boxes-in-boxes would be noise.
 */
function LeafCard(props: {
  /** Stable identity for both the React key and the expanded-state map. */
  readonly rowKey: string;
  /** Leading glyph — used only by the plain nested row (`framed: false`). */
  readonly icon?: React.ReactNode;
  readonly name: string;
  /** Extra node rendered right after the name (e.g. the project badge). */
  readonly badge?: React.ReactNode;
  readonly description?: string | undefined;
  readonly facts?: readonly CardFact[] | undefined;
  readonly toggle: React.ReactNode;
  readonly expanded: boolean;
  readonly filtering: boolean;
  readonly framed?: boolean;
  readonly t: Translate;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { rowKey, description } = props;
  const framed = props.framed !== false;
  const disclosure = resolveDisclosure(props.expanded, props.filtering);
  if (!framed) {
    return React.createElement(
      'li',
      { className: 'ci-toolrow ci-preset-item' },
      disclosureRow({
        rowKey,
        expanded: props.expanded,
        filtering: props.filtering,
        onOpenChange: props.onOpenChange,
        triggerLabel: detailAria(props.t, props.name, disclosure.open, disclosure.disabled),
        className: 'ci-preset-disclosure',
        headerClassName: 'ci-row-head ci-preset-tool-row',
        spacerClassName: 'ci-preset-spacer',
        icon: props.icon,
        heading: React.createElement('span', { className: 'ci-preset-tool-name' }, props.name, props.badge),
        actions: [props.toggle],
        detail: description === undefined
          ? undefined
          : React.createElement('div', { className: 'ci-preset-detail' }, description),
      }),
    );
  }
  const facts = props.facts ?? [];
  const expandable = description !== undefined || facts.length > 0;
  const title = React.createElement('strong', { className: 'ci-cap-card-title' }, props.name, props.badge);
  if (!expandable) {
    // Nothing to reveal: a static card, no chevron anywhere.
    return React.createElement(
      'li',
      { className: 'ci-preset-item ci-cap-card' },
      React.createElement(
        'div',
        { className: 'ci-cap-card-content' },
        React.createElement(
          'div',
          { className: 'ci-cap-card-main' },
          React.createElement('strong', { className: 'ci-cap-card-title ci-cap-card-title-static' }, props.name, props.badge),
          React.createElement('span', { className: 'ci-cap-card-trailing' }, props.toggle),
        ),
      ),
    );
  }
  const aria = detailAria(props.t, props.name, disclosure.open, disclosure.disabled);
  const detailId = `ci-detail-${encodeURIComponent(rowKey)}`;
  return React.createElement(
    'li',
    { className: 'ci-preset-item ci-cap-card', ...(disclosure.open ? { 'data-open': 'true' } : {}) },
    React.createElement(
      Collapsible.Root,
      { open: disclosure.open, onOpenChange: props.onOpenChange },
      React.createElement(
        'div',
        { className: 'ci-cap-card-content' },
        React.createElement(
          'div',
          { className: 'ci-cap-card-main' },
          React.createElement(
            Collapsible.Trigger,
            { className: 'ci-cap-card-expand', disabled: disclosure.disabled, 'aria-label': aria },
            title,
          ),
          React.createElement(
            'span',
            { className: 'ci-cap-card-trailing' },
            props.toggle,
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'ci-cap-card-chevronbtn',
                'aria-expanded': disclosure.open,
                'aria-controls': detailId,
                'aria-label': aria,
                disabled: disclosure.disabled,
                onClick: () => { props.onOpenChange(!disclosure.open); },
              },
              React.createElement('span', { className: 'ci-cap-card-chevron', 'aria-hidden': true }, React.createElement(IconChevronDown, { size: 14 })),
            ),
          ),
        ),
        description === undefined ? null : React.createElement('span', { className: 'ci-cap-card-desc' }, description),
      ),
      facts.length === 0
        ? null
        : React.createElement(
          Collapsible.Panel,
          { className: 'ci-collapse', id: detailId },
          React.createElement(
            'div',
            { className: 'ci-cap-card-details' },
            React.createElement(
              'dl',
              { className: 'ci-cap-facts' },
              ...facts.map((fact) =>
                React.createElement(
                  'div',
                  { key: fact.label },
                  React.createElement('dt', null, fact.label),
                  React.createElement('dd', null, fact.value),
                ),
              ),
            ),
          ),
        ),
    ),
  );
}

/** The translated source label, falling back to the raw runtime value. */
function sourceLabel(t: Translate, source: string): string {
  const key = `source.${source}`;
  const translated = t(key);
  return translated === key ? source : translated;
}

function SkillCard(props: {
  readonly t: Translate;
  readonly skill: PresetSkillView;
  readonly presetId: string;
  readonly expanded: boolean;
  readonly filtering: boolean;
  readonly locked: boolean;
  readonly busy: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t, skill } = props;
  const facts: CardFact[] = [
    ...(skill.source === undefined ? [] : [{ label: t('card.source'), value: sourceLabel(t, skill.source) }]),
    ...(skill.path === undefined ? [] : [{ label: t('card.path'), value: skill.path }]),
  ];
  return React.createElement(LeafCard, {
    rowKey: `skill:${skill.name}`,
    name: skill.name,
    // A project skill is real but conditional: it exists because THIS
    // workspace supplies it, and a session opened elsewhere will not see
    // it. Marking beats hiding, which would just look like a short list.
    badge: skill.project === true
      ? React.createElement('span', { className: 'ci-preset-badge' }, t('preset.projectSkill'))
      : undefined,
    description: skill.description,
    facts,
    toggle: React.createElement(CapabilitySwitch, {
      on: skill.enabled,
      frozen: false,
      locked: props.locked,
      busy: props.busy,
      label: t(skill.enabled ? 'action.disable' : 'action.enable', { name: skill.name }),
      onChange: (checked) => { void setPresetSkill(props.presetId, skill.name, checked); },
    }),
    expanded: props.expanded,
    filtering: props.filtering,
    framed: true,
    t,
    onOpenChange: props.onOpenChange,
  });
}

function ToolCard(props: {
  readonly t: Translate;
  readonly tool: PresetToolView;
  readonly presetId: string;
  /** True for tools nested inside a server card: they stay plain rows. */
  readonly nested: boolean;
  readonly expanded: boolean;
  readonly filtering: boolean;
  readonly locked: boolean;
  readonly busy: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t, tool } = props;
  // The full wire name only adds information when it differs from the
  // label — MCP tools carry `mcp__server__tool` while their label is the
  // short name; system tools read the same either way.
  const facts: CardFact[] = tool.name === tool.label
    ? []
    : [{ label: t('card.name'), value: React.createElement('code', null, tool.name) }];
  return React.createElement(LeafCard, {
    rowKey: `tool:${tool.name}`,
    icon: toolRowIcon(),
    name: tool.label,
    description: tool.description,
    facts,
    toggle: React.createElement(CapabilitySwitch, {
      on: tool.enabled,
      frozen: tool.reserved === true,
      locked: props.locked,
      busy: props.busy,
      label: tool.reserved === true
        ? t('preset.reserved', { name: tool.label })
        : t(tool.enabled ? 'action.disable' : 'action.enable', { name: tool.label }),
      onChange: (checked) => { void setPresetTool(props.presetId, tool.name, checked); },
    }),
    expanded: props.expanded,
    filtering: props.filtering,
    framed: !props.nested,
    t,
    onOpenChange: props.onOpenChange,
  });
}

function ServerCard(props: {
  readonly t: Translate;
  readonly server: PresetMcpView;
  readonly presetId: string;
  readonly expanded: boolean;
  readonly filtering: boolean;
  readonly locked: boolean;
  readonly busy: boolean;
  readonly reconnecting: boolean;
  readonly reconnectBlocked: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onReconnect: (server: string) => void;
  readonly toolExpanded: (rowKey: string) => boolean;
  readonly onToolOpenChange: (rowKey: string, open: boolean) => void;
}): React.ReactElement {
  const { t, server, reconnecting } = props;
  const disclosure = resolveDisclosure(props.expanded, props.filtering);
  const aria = detailAria(t, server.server, disclosure.open, disclosure.disabled);
  const detailId = `ci-detail-${encodeURIComponent(server.server)}`;
  // While the server is down there is no name to store a toggle
  // for: report the state and offer the one action that can still
  // change it. Reconnectable servers get a manual pull-up that does
  // not wait out the client's reconnect backoff.
  const trailing = [
    server.unavailable === true
      ? React.createElement(
        'span',
        { key: 'state', className: 'ci-preset-badge', title: t('server.unavailableHint') },
        t('server.unavailable'),
      )
      : React.createElement(CapabilitySwitch, {
        key: 'switch',
        on: server.enabled,
        frozen: false,
        locked: props.locked,
        busy: props.busy,
        label: t(server.enabled ? 'action.disable' : 'action.enable', { name: server.server }),
        onChange: (checked) => { void setPresetServer(props.presetId, server.server, checked); },
      }),
    server.unavailable === true && server.reconnectable === true
      ? React.createElement(
        'button',
        {
          key: 'reconnect',
          type: 'button',
          className: `ci-reconnect${reconnecting ? ' ci-reconnect-busy' : ''}`,
          disabled: props.reconnectBlocked,
          title: reconnecting
            ? t('action.reload.ing', { name: server.server })
            : `${t('action.reload', { name: server.server })}\n${t('action.reloadHint')}`,
          'aria-label': t('action.reload', { name: server.server }),
          onClick: () => { if (!props.reconnectBlocked) props.onReconnect(server.server); },
        },
        React.createElement('span', { className: 'ci-reconnect-glyph', 'aria-hidden': true }, React.createElement(IconRefresh, { size: 14 })),
        t('action.reload.label'),
      )
      : null,
  ];
  const title = React.createElement('strong', { className: 'ci-cap-card-title' }, server.server);
  // Nothing is registered, so a tool count would be a lie: the
  // listed rows are this preset's stored default, not a roster.
  const count = server.unavailable === true
    ? null
    : React.createElement(
      'span',
      { className: 'ci-cap-card-desc' },
      server.tools.length === 1 ? t('server.tool.one') : t('server.tools', { count: server.tools.length }),
    );
  const nestedTools = React.createElement(
    'ul',
    { className: 'ci-preset-tool-list' },
    ...server.tools.map((tool) =>
      React.createElement(ToolCard, {
        key: tool.name,
        t,
        tool,
        presetId: props.presetId,
        nested: true,
        expanded: props.toolExpanded(`tool:${tool.name}`),
        filtering: props.filtering,
        locked: props.locked,
        busy: props.busy,
        onOpenChange: (open) => { props.onToolOpenChange(`tool:${tool.name}`, open); },
      }),
    ),
  );
  if (server.tools.length === 0) {
    // Nothing to reveal: a static card, no chevron anywhere.
    return React.createElement(
      'li',
      { className: 'ci-preset-item ci-preset-group ci-cap-card' },
      React.createElement(
        'div',
        { className: 'ci-cap-card-content' },
        React.createElement(
          'div',
          { className: 'ci-cap-card-main' },
          React.createElement('strong', { className: 'ci-cap-card-title ci-cap-card-title-static' }, server.server),
          React.createElement('span', { className: 'ci-cap-card-trailing' }, ...trailing),
        ),
        count,
      ),
    );
  }
  return React.createElement(
    'li',
    { className: 'ci-preset-item ci-preset-group ci-cap-card', ...(disclosure.open ? { 'data-open': 'true' } : {}) },
    React.createElement(
      Collapsible.Root,
      { open: disclosure.open, onOpenChange: props.onOpenChange },
      React.createElement(
        'div',
        { className: 'ci-cap-card-content' },
        React.createElement(
          'div',
          { className: 'ci-cap-card-main' },
          React.createElement(
            Collapsible.Trigger,
            { className: 'ci-cap-card-expand', disabled: disclosure.disabled, 'aria-label': aria },
            title,
          ),
          React.createElement(
            'span',
            { className: 'ci-cap-card-trailing' },
            ...trailing,
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'ci-cap-card-chevronbtn',
                'aria-expanded': disclosure.open,
                'aria-controls': detailId,
                'aria-label': aria,
                disabled: disclosure.disabled,
                onClick: () => { props.onOpenChange(!disclosure.open); },
              },
              React.createElement('span', { className: 'ci-cap-card-chevron', 'aria-hidden': true }, React.createElement(IconChevronDown, { size: 14 })),
            ),
          ),
        ),
        count,
      ),
      React.createElement(
        Collapsible.Panel,
        { className: 'ci-collapse', id: detailId },
        React.createElement('div', { className: 'ci-cap-card-details' }, nestedTools),
      ),
    ),
  );
}

/**
 * The preset switcher: the host's own preset-mode pill (a module-platform
 * button carrying the current value and a chevron). Menu owns the popup —
 * a native <select> cannot follow --dsw-* tokens.
 */
function PresetPicker(props: {
  readonly t: Translate;
  readonly presets: readonly { id: string; name: string }[];
  readonly selectedId: string | null;
  readonly selectedName: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t } = props;
  return React.createElement(
    Menu,
    {
      open: props.open,
      anchor: React.createElement(
        'button',
        {
          type: 'button',
          className: 'ci-preset-picker-trigger',
          // Menu renders role="menu"; the visible text is the current
          // value, so name the trigger explicitly.
          'aria-haspopup': 'menu',
          'aria-expanded': props.open,
          'aria-label': t('preset.choose'),
          onClick: () => { props.onOpenChange(!props.open); },
        },
        React.createElement('span', { className: 'ci-preset-picker-name' }, props.selectedName),
        React.createElement(
          'span',
          { className: `ci-preset-picker-chevron${props.open ? ' ci-preset-picker-chevron-open' : ''}`, 'aria-hidden': true },
          React.createElement(IconChevronDown, { size: 14 }),
        ),
      ),
      items: props.presets.map((preset) => ({ id: preset.id, label: preset.name })),
      ...(props.selectedId === null ? {} : { selectedId: props.selectedId }),
      onSelect: (id: string) => { selectPreset(id); props.onOpenChange(false); },
      onClose: () => { props.onOpenChange(false); },
    },
  );
}

/**
 * The kind switcher: the design system's SegmentedControl on 0.1.7+ (the
 * same in-page mode switch the models settings page uses), the local
 * compact tabs on older hosts. Same three categories plus "all" — this
 * panel is wide enough to show every part at once, so "all" is the useful
 * default and the switcher narrows it.
 */
function KindTabs(props: {
  readonly t: Translate;
  readonly kind: SegmentedKind;
  readonly counts: { skills: number; mcp: number; systemTools: number };
  readonly onChange: (kind: SegmentedKind) => void;
}): React.ReactElement {
  const { t, kind, counts } = props;
  const options: readonly { value: SegmentedKind; label: string }[] = [
    { value: 'all', label: t('tab.all') },
    { value: 'skills', label: `${t('tab.skills')} ${counts.skills}` },
    { value: 'mcp', label: `${t('tab.mcp')} ${counts.mcp}` },
    { value: 'system', label: `${t('tab.system')} ${counts.systemTools}` },
  ];
  const Segmented = (primitives as unknown as { SegmentedControl?: SegmentedControlComponent }).SegmentedControl;
  if (Segmented !== undefined) {
    return React.createElement(Segmented, {
      id: 'ci-preset-kinds',
      label: t('preset.kindAria'),
      value: kind,
      options,
      onChange: props.onChange,
    });
  }
  return React.createElement(
    Tabs.Root,
    { value: kind, onValueChange: (value: string) => { props.onChange(value as SegmentedKind); }, className: 'ci-preset-kinds' },
    React.createElement(
      Tabs.List,
      { 'aria-label': t('preset.kindAria'), className: 'ci-tabs' },
      ...options.map((option) =>
        React.createElement(
          Tabs.Tab,
          {
            key: option.value,
            value: option.value,
            className: 'ci-tab',
            ...(option.value === 'system' ? { 'aria-label': t('tab.system.aria', { count: counts.systemTools }) } : {}),
          },
          option.label,
        ),
      ),
    ),
  );
}

/**
 * Settings-side twin of the composer panel, laid out as the host plugin
 * inventory page is: a filter row with the preset picker, a kind switcher
 * that owns category filtering and counts, then capability CARDS in one
 * flow — one framed box per entry with its switch on the head row, a
 * clamped description preview, and the full text on expand. Source
 * grouping stays: two scopes of one feature should not feel like two
 * unrelated features, and "where does this come from" is half of what
 * this page answers.
 */
export function PresetToolSection(props: PresetToolSectionProps): React.ReactElement {
  const { t } = props;
  const state = React.useSyncExternalStore(subscribePresetTools, getPresetToolsSnapshot);
  React.useSyncExternalStore(props.subscribeLocale, props.getLocaleSnapshot);
  React.useEffect(() => { void loadPresetTools(); }, []);
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [kind, setKind] = React.useState<SegmentedKind>('all');
  // The preset picker's popup is owner-controlled like every Menu consumer.
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // Which server is mid-reconnect: its button spins and disables until the
  // request settles, so a click reads as "starting" not "nothing happened".
  const [reconnecting, setReconnecting] = React.useState<string | null>(null);

  const selected = state.payload?.presets.find((preset) => preset.id === state.selectedId);
  const filtering = query.trim() !== '';
  const view: FilteredPreset | null = selected === undefined ? null : filterPreset(selected, query);
  const writable = state.payload?.writable === true;
  const locked = state.loading || !writable;

  const setRowOpen = (rowKey: string, open: boolean): void => {
    setExpanded((prev) => ({ ...prev, [rowKey]: open }));
  };
  const reconnect = (server: string): void => {
    setReconnecting(server);
    void reconnectPresetServer(server).finally(() => { setTimeout(() => { setReconnecting(null); }, 2500); });
  };

  const body = (): React.ReactElement | null => {
    if (selected === undefined || view === null) return React.createElement('p', null, t('preset.empty'));
    if (selected.broken !== undefined) {
      return React.createElement(
        'p',
        { role: 'alert', className: 'ci-settings-note', style: { color: TOK.error } },
        t('preset.broken', { reason: selected.broken }),
      );
    }
    if (view.total === 0) {
      return React.createElement('p', null, filtering ? t('empty.match') : t('preset.noTools'));
    }
    // Three categories in one flow, sequenced skills → MCP → system tools:
    // the kind switcher above already owns category filtering and counts,
    // so a second collapsible layer would only repeat it. Skills and MCP
    // keep their source dividers; system tools are one uniform tail.
    const grids: React.ReactElement[] = [];
    const grid = (key: 'skills' | 'mcp' | 'system', cards: readonly React.ReactElement[]): void => {
      if (kind !== 'all' && kind !== key) return;
      if (cards.length === 0) return;
      grids.push(React.createElement('ul', { key, className: 'ci-cap-cards' }, ...cards));
    };

    grid(
      'skills',
      groupBy(view.skills, (skill) => skill.group ?? skill.source ?? 'unknown').flatMap(([groupKey, items], i) => [
        React.createElement(SourceDivider, { key: `source:${groupKey}`, t, groupKey, items, first: i === 0 }),
        ...items.map((skill) =>
          React.createElement(SkillCard, {
            key: skill.name,
            t,
            skill,
            presetId: selected.id,
            expanded: expanded[`skill:${skill.name}`] === true,
            filtering,
            locked,
            busy: state.loading,
            onOpenChange: (open) => { setRowOpen(`skill:${skill.name}`, open); },
          }),
        ),
      ]),
    );
    grid(
      'mcp',
      groupBy(view.mcp, (server) => server.source === undefined || server.source === 'host' ? 'host' : `preset:${server.source}`).flatMap(([groupKey, items], i) => [
        React.createElement(SourceDivider, { key: `source:${groupKey}`, t, groupKey, items, first: i === 0 }),
        ...items.map((server) =>
          React.createElement(ServerCard, {
            key: server.server,
            t,
            server,
            presetId: selected.id,
            expanded: expanded[`mcp:${server.server}`] === true,
            filtering,
            locked,
            busy: state.loading,
            reconnecting: reconnecting === server.server,
            reconnectBlocked: reconnecting !== null,
            onOpenChange: (open) => { setRowOpen(`mcp:${server.server}`, open); },
            onReconnect: reconnect,
            toolExpanded: (rowKey) => expanded[rowKey] === true,
            onToolOpenChange: setRowOpen,
          }),
        ),
      ]),
    );
    grid(
      'system',
      view.systemTools.map((tool) =>
        React.createElement(ToolCard, {
          key: tool.name,
          t,
          tool,
          presetId: selected.id,
          nested: false,
          expanded: expanded[`tool:${tool.name}`] === true,
          filtering,
          locked,
          busy: state.loading,
          onOpenChange: (open) => { setRowOpen(`tool:${tool.name}`, open); },
        }),
      ),
    );
    // Narrowing to a category that this preset has nothing in is a normal
    // outcome, not an error: say so rather than render an empty panel.
    if (grids.length === 0) {
      return React.createElement('p', null, filtering ? t('empty.match') : t('preset.noTools'));
    }
    return React.createElement(React.Fragment, null, ...grids);
  };

  return React.createElement(
    'div',
    { className: 'ci-preset-section' },
    React.createElement('h2', { className: 'ci-settings-title' }, t('preset.title')),
    React.createElement('p', { className: 'ci-settings-intro' }, t('preset.intro')),
    state.error === null
      ? null
      : React.createElement('p', { role: 'alert', style: { color: TOK.error } }, t('status.error', { error: state.error })),
    state.loading && state.payload === null
      ? React.createElement('p', { 'aria-live': 'polite', style: { color: TOK.textTertiary } }, t('status.loading'))
      : null,
    state.payload === null
      ? null
      : React.createElement(
          React.Fragment,
          null,
          writable
            ? null
            : React.createElement('p', { role: 'note', className: 'ci-settings-note' }, t('preset.readonly')),
          React.createElement(
            'div',
            { className: 'ci-preset-toolbar' },
            // The host inventory page's search row: the magnifier lives inside
            // the field (pinned at left 12px), the input takes the full width.
            React.createElement(
              'div',
              { className: 'ci-search' },
              React.createElement(IconSearch, { size: 14 }),
              React.createElement(Input, {
                className: 'ci-filter ci-preset-filter',
                value: query,
                placeholder: t('filter.placeholder'),
                'aria-label': t('filter.aria'),
                autoComplete: 'off',
                spellCheck: false,
                name: 'ci-preset-filter',
                onChange: (event: { target: { value: string } }) => { setQuery(event.target.value); },
                onKeyDown: (event: { key: string }) => { if (event.key === 'Escape' && filtering) setQuery(''); },
              }),
            ),
            React.createElement(PresetPicker, {
              t,
              presets: state.payload.presets,
              selectedId: state.selectedId,
              selectedName: selected?.name ?? '',
              open: pickerOpen,
              onOpenChange: setPickerOpen,
            }),
          ),
          selected === undefined
            ? null
            : React.createElement(KindTabs, {
              t,
              kind,
              counts: { skills: selected.skills.length, mcp: selected.mcp.length, systemTools: selected.systemTools.length },
              onChange: setKind,
            }),
          selected?.description === undefined
            ? null
            : React.createElement('p', { className: 'ci-settings-description' }, selected.description),
          view === null || !filtering
            ? null
            : React.createElement(
                'p',
                { 'aria-live': 'polite', className: 'ci-settings-description' },
                t('filter.count', { shown: view.total, total: selected === undefined ? 0 : selected.skills.length + selected.mcp.length + selected.systemTools.length }),
              ),
          body(),
        ),
  );
}
