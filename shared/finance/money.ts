// Exact string grouping avoids floating division and native Intl BigInt dependencies.
export const FINANCE_CURRENCIES = ['INR','USD','EUR','GBP','AED','SGD','AUD','CAD'] as const;
const symbols: Record<string,string> = {INR:'₹',USD:'$',EUR:'€',GBP:'£',AED:'AED\u00a0',SGD:'SGD\u00a0',AUD:'A$',CAD:'CA$'};
export function formatExactMoney(minor:number|string,currency='INR'):string {
  if(typeof minor==='number'&&!Number.isSafeInteger(minor)) throw new Error('Money must use safe integer minor units.');
  if(!FINANCE_CURRENCIES.includes(currency as typeof FINANCE_CURRENCIES[number])) throw new Error('Choose a supported company currency.');
  const raw=String(minor);if(!/^-?\d+$/.test(raw))throw new Error('Money must use decimal integer minor units.');
  const digits=raw.replace(/^-/,'').replace(/^0+(?=\d)/,'');
  const padded=digits.padStart(3,'0');const major=padded.slice(0,-2);const fraction=padded.slice(-2);
  let grouped:string;
  if(currency==='INR'&&major.length>3){const head=major.slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g,',');grouped=head+','+major.slice(-3)}
  else grouped=major.replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return (raw.startsWith('-')&&digits!=='0'?'-':'')+symbols[currency]+grouped+'.'+fraction;
}
