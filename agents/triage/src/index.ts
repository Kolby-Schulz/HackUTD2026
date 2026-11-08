// Jev triage (spec section 12b, STRETCH; build after the MVP). Owner: coordinator + mapper.
// npm run triage. Off unless TRIAGE=on; everything must work without it.
import 'dotenv/config';
if (process.env.TRIAGE !== 'on') {
  console.log('triage: TRIAGE is off, exiting');
  process.exit(0);
}
console.log('triage: not implemented yet');
