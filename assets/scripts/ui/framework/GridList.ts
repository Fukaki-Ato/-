import { isValid, Node, UITransform } from 'cc';
import { Logger } from '../../core/framework/Logger';
import { EmptyState } from './EmptyState';
import { node, ScrollViewView, scrollView } from './UIKit';

const log = new Logger();

/** 一次性创建上限（docs/04 §2）；超出截断并 warn。 */
export const MAX_LIST_CELLS = 120;

export interface GridListOptions {
  parent: Node;
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  gapX?: number;
  gapY?: number;
  padding?: number;
  emptyText?: string;
  onEmpty?: (isEmpty: boolean) => void;
}

export type CellRenderer<T> = (item: T, cell: Node, index: number) => void;

/**
 * 数据驱动网格列表：内部为 ScrollView + 手工定位单元格。
 * render 每次 setData 都会被调用，单元格子节点会在渲染前清空（请勿依赖跨刷新的节点复用）。
 */
export class GridList<T = unknown> {
  readonly node: Node;
  readonly content: Node;

  private readonly options: GridListOptions;
  private readonly scrollInfo: ScrollViewView;
  private cells: Node[] = [];
  private emptyNode: Node | null = null;

  constructor(opts: GridListOptions) {
    this.options = opts;
    this.scrollInfo = scrollView({ parent: opts.parent, width: opts.width, height: opts.height });
    this.node = this.scrollInfo.node;
    this.content = this.scrollInfo.content;
  }

  get count(): number {
    return this.cells.filter((cell) => cell.active).length;
  }

  setData(items: readonly T[], render: CellRenderer<T>): void {
    const { cellWidth, cellHeight, gapX = 0, gapY = 0, padding = 0, width, height } = this.options;
    const columns = Math.max(1, Math.floor(this.options.columns));
    if (items.length > MAX_LIST_CELLS) {
      log.warn(`列表项 ${items.length} 超过上限 ${MAX_LIST_CELLS}，已截断`);
    }
    const list = items.slice(0, MAX_LIST_CELLS);
    this.ensureCells(list.length);
    this.cells.forEach((cell, index) => {
      const item = list[index];
      if (item === undefined) {
        cell.active = false;
        return;
      }
      cell.active = true;
      const column = index % columns;
      const row = Math.floor(index / columns);
      cell.setPosition(
        -width / 2 + padding + cellWidth / 2 + column * (cellWidth + gapX),
        -(padding + cellHeight / 2 + row * (cellHeight + gapY)),
        0,
      );
      for (const child of cell.children.slice()) {
        child.removeFromParent();
        child.destroy();
      }
      render(item, cell, index);
    });

    const rows = Math.ceil(list.length / columns);
    const contentHeight = Math.max(height, padding * 2 + rows * cellHeight + Math.max(0, rows - 1) * gapY);
    const contentUi = this.content.getComponent(UITransform);
    contentUi?.setContentSize(width, contentHeight);
    this.content.setPosition(0, height / 2, 0);

    if (list.length === 0) {
      if (!this.emptyNode || !isValid(this.emptyNode)) {
        this.emptyNode = EmptyState.show(this.node, this.options.emptyText, { width, height: Math.min(height, 360) });
      }
      this.options.onEmpty?.(true);
    } else if (this.emptyNode) {
      this.emptyNode.destroy();
      this.emptyNode = null;
      this.options.onEmpty?.(false);
    }
  }

  /** 清空单元格与空态（不销毁列表本体）。 */
  clear(): void {
    for (const cell of this.cells) {
      for (const child of cell.children.slice()) {
        child.removeFromParent();
        child.destroy();
      }
      cell.active = false;
    }
    if (this.emptyNode && isValid(this.emptyNode)) this.emptyNode.destroy();
    this.emptyNode = null;
  }

  private ensureCells(count: number): void {
    const { cellWidth, cellHeight } = this.options;
    while (this.cells.length < count) {
      const index = this.cells.length;
      const cell = node(`cell_${index}`, { parent: this.content, size: { width: cellWidth, height: cellHeight } });
      this.cells.push(cell);
    }
  }
}
