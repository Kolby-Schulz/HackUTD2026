// One owner for document.title: "(N) <file name> · Playground". The top bar sets the name, the chat panel the unread count.
export const composeTitle = (name: string, unread: number): string =>
  `${unread > 0 ? `(${unread}) ` : ''}${name} · Playground`;

let name = 'Untitled';
let unread = 0;
const apply = () => { if (typeof document !== 'undefined') document.title = composeTitle(name, unread); };

export function setTitleName(n: string) { name = n; apply(); }
export function setTitleUnread(n: number) { unread = n; apply(); }
