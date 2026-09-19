// Ported from OHIF Viewers monorepo organization (architecture only).
// Steals: extensions/* + platform/* split, MODULE_TYPES vocabulary,
// extension manifest shape, modulesMap namespacing, mode preset shape,
// boot order. No viewer logic, no rendering.

export const MODULE_TYPES = {
  COMMANDS: 'commandsModule',
  CUSTOMIZATION: 'customizationModule',
  STATE_SYNC: 'stateSyncModule',
  DATA_SOURCE: 'dataSourcesModule',
  PANEL: 'panelModule',
  SOP_CLASS_HANDLER: 'sopClassHandlerModule',
  TOOLBAR: 'toolbarModule',
  VIEWPORT: 'viewportModule',
  CONTEXT: 'contextModule',
  LAYOUT_TEMPLATE: 'layoutTemplateModule',
  HANGING_PROTOCOL: 'hangingProtocolModule',
  UTILITY: 'utilityModule',
} as const;

export type ModuleType = (typeof MODULE_TYPES)[keyof typeof MODULE_TYPES];

export interface ExtensionContext {
  configuration?: Record<string, unknown>;
}

export interface ExtensionManifest {
  /** REQUIRED: package name, e.g. '@carys/extension-cornerstone' */
  id: string;
  preRegistration?(ctx: ExtensionContext): void | Promise<void>;
  getViewportModule?(ctx: ExtensionContext): unknown;
  getToolbarModule?(ctx: ExtensionContext): unknown;
  getPanelModule?(ctx: ExtensionContext): unknown;
  getCommandsModule?(ctx: ExtensionContext): CommandDefinitions | undefined;
  getSopClassHandlerModule?(ctx: ExtensionContext): unknown;
  getHangingProtocolModule?(ctx: ExtensionContext): unknown;
  getCustomizationModule?(ctx: ExtensionContext): unknown;
  getUtilityModule?(ctx: ExtensionContext): unknown;
  getDataSourcesModule?(ctx: ExtensionContext): unknown;
  getLayoutTemplateModule?(ctx: ExtensionContext): unknown;
  getContextModule?(ctx: ExtensionContext): unknown;
  onModeEnter?(): void;
  onModeExit?(): void;
}

/** modulesMap key: "${extensionId}.${moduleType}.${name}" */
export function moduleKey(extensionId: string, moduleType: string, name: string): string {
  return `${extensionId}.${moduleType}.${name}`;
}

export interface CommandDefinitions {
  definitions: Record<string, (...args: unknown[]) => unknown>;
  defaultContext?: string;
}

/** Mode preset shape (OHIF modes/basic, inheritance-by-spread). */
export interface ModePreset {
  id: string;
  routeName: string;
  displayName: string;
  extensions: string[];
  sopClassHandlers: string[];
  toolbarButtons?: string[];
}

/** Boot order (OHIF appInit): managers -> core services -> loadModules ->
 * registerExtensions -> customization init -> modeFactory. */
export const BOOT_ORDER = [
  'managers',
  'core-services',
  'load-modules',
  'register-extensions',
  'customization-init',
  'mode-factory',
] as const;
