import { handleAgentSearch } from '../src/tools/search-ops.js';
import { handlePassportRead } from '../src/tools/identity-ops.js';

(async () => {
  console.log('── search: tuichan ──');
  const s = await handleAgentSearch({ query: 'tuichan' });
  console.log(s.content[0].text);

  console.log('\n── passport_read sed:commons:12 ──');
  const p = await handlePassportRead({ agent_id: 'sed:commons:12' });
  console.log(p.content[0].text.slice(0, 700));

  console.log('\n── passport_read sed:commons:11 ──');
  const p2 = await handlePassportRead({ agent_id: 'sed:commons:11' });
  console.log(p2.content[0].text.slice(0, 500));

  console.log('\n── search: happyseaurchin ──');
  const s2 = await handleAgentSearch({ query: 'happyseaurchin' });
  console.log(s2.content[0].text);
})();
