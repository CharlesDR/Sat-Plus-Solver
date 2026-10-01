export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
}

export class Issues {
  readonly list: Issue[] = [];
  error(code: string, message: string): void {
    this.list.push({ severity: 'error', code, message });
  }
  warn(code: string, message: string): void {
    this.list.push({ severity: 'warning', code, message });
  }
  get errors(): Issue[] {
    return this.list.filter((i) => i.severity === 'error');
  }
  get warnings(): Issue[] {
    return this.list.filter((i) => i.severity === 'warning');
  }
}
