import { slugify } from '@app/utils';
import { shout } from '@app/legacy.js';

export function pageUrl(title: string): string {
  return `/p/${slugify(shout(title))}`;
}
