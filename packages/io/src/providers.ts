// Ported from Neuroglancer datasource/index.ts (DataSourceProvider /
// KvStoreBasedDataSourceProvider / DataSourceRegistry) + default_provider +
// url scheme dispatch. CPU-only: providers return loader hints, not GL.

export interface DataSourceLookup {
  kind: string;
  ref: string;
  label: string;
}

export interface DataSourceProvider {
  scheme: string;
  get(ref: string): Promise<DataSourceLookup>;
}

export class DataSourceRegistry {
  private providers = new Map<string, DataSourceProvider>();

  register(p: DataSourceProvider): void {
    this.providers.set(p.scheme, p);
  }

  async resolve(url: string): Promise<DataSourceLookup> {
    const scheme = url.split('://')[0];
    const p = this.providers.get(scheme);
    if (!p) throw new Error(`No provider for scheme: ${scheme}`);
    return p.get(url);
  }

  get schemes(): string[] {
    return [...this.providers.keys()];
  }
}

/** Local + standard schemes (Neuroglancer local.ts + default_provider). */
export function defaultRegistry(): DataSourceRegistry {
  const r = new DataSourceRegistry();
  for (const scheme of ['precomputed', 'n5', 'zarr', 'nifti', 'file', 'http', 'https']) {
    r.register({
      scheme,
      get: async (ref) => ({ kind: scheme, ref, label: ref.split('/').pop() ?? ref }),
    });
  }
  return r;
}
