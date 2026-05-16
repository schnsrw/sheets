import type { Univer } from '@univerjs/core';
import { IMenuManagerService, MenuItemType, ContextMenuGroup, ContextMenuPosition } from '@univerjs/ui';

/**
 * Augments Univer's built-in cell context menu with operations we want there
 * but that the stock sheets-ui schema only puts on the ribbon — e.g. Merge.
 *
 * Univer doesn't expose its menu-item factories from `@univerjs/sheets-ui`
 * publicly, so we register thin proxy factories that point at the public
 * command ids:
 *   - sheet.command.add-worksheet-merge-all  (reads current selection)
 *   - sheet.command.remove-worksheet-merge   (reads current selection)
 *
 * Both commands resolve their target range from the selection manager, so we
 * don't need to construct params here.
 */
export function extendContextMenu(univer: Univer): void {
  const injector = univer.__getInjector();
  const menuMgr = injector.get(IMenuManagerService);

  menuMgr.mergeMenu({
    [ContextMenuPosition.MAIN_AREA]: {
      [ContextMenuGroup.FORMAT]: {
        'sheet.command.add-worksheet-merge-all': {
          order: 100,
          menuItemFactory: () => ({
            id: 'sheet.command.add-worksheet-merge-all',
            type: MenuItemType.BUTTON,
            icon: 'MergeAllSingle',
            title: 'Merge cells',
          }),
        },
        'sheet.command.remove-worksheet-merge': {
          order: 101,
          menuItemFactory: () => ({
            id: 'sheet.command.remove-worksheet-merge',
            type: MenuItemType.BUTTON,
            icon: 'CancelMergeSingle',
            title: 'Unmerge',
          }),
        },
      },
    },
  });
}
