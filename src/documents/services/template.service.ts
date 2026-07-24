import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

/**
 * Compiled templates are cached in memory — reading + compiling from disk on every
 * PDF would add real latency to every single document generated, for content that
 * never changes at runtime.
 */
@Injectable()
export class TemplateService {
  private readonly cache = new Map<string, Handlebars.TemplateDelegate>();
  private registered = false;

  render(name: string, data: unknown): string {
    this.registerHelpersOnce();
    let compiled = this.cache.get(name);
    if (!compiled) {
      compiled = Handlebars.compile(this.read(name), { strict: false });
      this.cache.set(name, compiled);
    }
    return compiled(data);
  }

  private read(name: string): string {
    return fs.readFileSync(path.join(TEMPLATES_DIR, `${name}.hbs`), 'utf8');
  }

  private registerHelpersOnce() {
    if (this.registered) return;
    this.registered = true;

    // `_base` (shared <style> block) is a Handlebars PARTIAL, not a standalone
    // template — every document template includes it via `{{> _base}}`.
    Handlebars.registerPartial('_base', this.read('_base'));

    Handlebars.registerHelper('join', (arr: unknown, sep: string) =>
      Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : '',
    );
    // Dates are free text in the parsed schema ("Jan 2020", "2020", ...) — rendered
    // as-is, never re-parsed, since a malformed source date must not crash a PDF.
    Handlebars.registerHelper(
      'dateRange',
      (
        startDate: string | null,
        endDate: string | null,
        isCurrent: boolean,
      ) => {
        const end = isCurrent ? 'Present' : endDate || '';
        if (!startDate && !end) return '';
        return `${startDate ?? ''} – ${end}`;
      },
    );
  }
}
