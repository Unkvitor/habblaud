import { expect, it } from 'vitest';
import { mergeNativeItems } from './native-codex';
it('reconciles a streamed item with persisted history by id without losing older history', () => {
  const items = mergeNativeItems([{id:'old',text:'old'}, {id:'a',text:'partial'}], [{id:'a',text:'complete'}, {id:'new',text:'new'}]);
  expect(items.map(i => i.text)).toEqual(['old','complete','new']);
});