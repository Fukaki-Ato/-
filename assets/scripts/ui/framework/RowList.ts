import { GridList, GridListOptions } from './GridList';

export type RowListOptions = Omit<GridListOptions, 'cellWidth' | 'cellHeight' | 'columns'> & {
  /** 单行高度。 */
  rowHeight: number;
};

/** 单列行列表：GridList 的 columns=1 特化，接口与空态行为一致。 */
export class RowList<T = unknown> extends GridList<T> {
  constructor(opts: RowListOptions) {
    const padding = opts.padding ?? 0;
    super({
      ...opts,
      cellWidth: opts.width - padding * 2,
      cellHeight: opts.rowHeight,
      columns: 1,
    });
  }
}

/** 便于类型推断的工厂函数。 */
export function rowList<T>(opts: RowListOptions): RowList<T> {
  return new RowList<T>(opts);
}

export type { CellRenderer } from './GridList';
