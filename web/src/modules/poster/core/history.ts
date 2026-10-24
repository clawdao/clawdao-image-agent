import type { Canvas } from 'fabric';

export class CanvasHistory {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private doing = false;
  private saving = false;
  private currentState = '';
  private maxLength: number;
  private getJson: () => string;
  private boundSave: (() => void) | null = null;

  constructor(
    private canvas: Canvas,
    options: {
      getJson: () => string;
      maxLength?: number;
    },
  ) {
    this.getJson = options.getJson;
    this.maxLength = options.maxLength ?? 50;
    this.currentState = this.getJson();
  }

  private trim() {
    if (this.undoStack.length > this.maxLength) this.undoStack.shift();
    if (this.redoStack.length > this.maxLength) this.redoStack.shift();
  }

  public bind() {
    if (this.boundSave) return;
    this.boundSave = this.save.bind(this);
    this.canvas.on('object:added', this.boundSave);
    this.canvas.on('object:removed', this.boundSave);
    this.canvas.on('object:modified', this.boundSave);
    this.canvas.on('object:skewing', this.boundSave);
    this.canvas.on('ddn:object:modified' as any, this.boundSave as any);
  }

  public unbind() {
    if (!this.boundSave) return;
    this.canvas.off('object:added', this.boundSave);
    this.canvas.off('object:removed', this.boundSave);
    this.canvas.off('object:modified', this.boundSave);
    this.canvas.off('object:skewing', this.boundSave);
    this.canvas.off('ddn:object:modified' as any, this.boundSave as any);
    this.boundSave = null;
  }

  public canUndo() {
    return this.undoStack.length > 0;
  }

  public canRedo() {
    return this.redoStack.length > 0;
  }

  public reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.doing = false;
    this.saving = false;
    this.currentState = this.getJson();
  }

  public beginBatch() {
    this.saving = true;
  }

  public endBatch() {
    this.saving = false;
    this.save();
  }

  public save() {
    if (this.doing || this.saving) return;
    this.saving = true;

    const json = this.currentState;
    this.undoStack.push(json);
    this.trim();
    this.currentState = this.getJson();
    this.redoStack = [];

    this.saving = false;
  }

  public async undo(load: (json: string) => Promise<void>) {
    const state = this.undoStack.pop();
    if (!state) return;

    this.doing = true;
    this.redoStack.push(this.currentState);
    this.trim();
    this.currentState = state;
    await load(state);
    this.doing = false;
    this.canvas.fire('ddn:history:undo' as any);
  }

  public async redo(load: (json: string) => Promise<void>) {
    const state = this.redoStack.pop();
    if (!state) return;

    this.doing = true;
    this.undoStack.push(this.currentState);
    this.trim();
    this.currentState = state;
    await load(state);
    this.doing = false;
    this.canvas.fire('ddn:history:redo' as any);
  }
}
