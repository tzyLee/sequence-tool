import * as vscode from "vscode";
import { IndexSequenceGen } from './generator';
import { parseCommand } from "./parser";

const sequenceInsertionDecorationType = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: 'blue',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
});

export class CommandHandler {
    private editMade: boolean = false;
    private initialSelections: vscode.Selection[];
    constructor(private editor: vscode.TextEditor) {
        this.initialSelections = [...editor.selections].sort(sortSelection);
    }

    async doPreview(command: string) {
        let [gen, fmt, msg] = parseCommand(command);
        if (!gen) {
            // clear previews when gen == null
            gen = new IndexSequenceGen(0, () => '');
        }
        // When the inputbox is active, the previews cannot be clear with 'undo' command
        // the text in the inputbox would be undoed instead
        await insertSequence(this.editor, this.initialSelections, gen, fmt, { undoStopBefore: !this.editMade, undoStopAfter: false }, true, this.editMade);
        highlightPreview(this.editor, this.initialSelections);
        this.editMade = true;
        return msg;
    }

    private async clearPreview() {
        if (!this.editMade) {
            return;
        }
        // Clear preview
        await vscode.commands.executeCommand('undo');
        this.editor.setDecorations(sequenceInsertionDecorationType, []);
        // Make sure the undo only happens once
        this.editMade = false;
    }

    async execute(command: string) {
        // Attempt to clear preview even if the command is not valid
        await this.clearPreview();
        if (!command) {
            return;
        }
        const [gen, fmt, _] = parseCommand(command);
        if (gen) {
            await insertSequence(this.editor, this.initialSelections, gen, fmt, {
                undoStopBefore: false,
                undoStopAfter: true
            }, false);
        }
    }
}

export async function insertSequence(editor: vscode.TextEditor, initialSelections: vscode.Selection[], gen: SequenceGen, fmt: Formatter, option: EditOption, isPreview: boolean, deleteBeforeInsert: boolean = false) {
    return await editor.edit((builder) => {
        const selections = [...editor.selections].sort(sortSelection);
        let visibleRange = editor.visibleRanges[0];
        if (isPreview) {
            editor.visibleRanges.forEach((r) => { visibleRange = visibleRange.union(r); });
        }
        // always insert at the end of selections
        const len = initialSelections.length;
        let lastLine = -1;
        let curCharDelta = 0; // records the number of character delted so far on current line
        for (let i = 0; i < len; i++) {
            const initSel = initialSelections[i];
            const sel = selections[i];
            // Still calculates replacement even when the selection is out of preview range
            let val = gen.next(i).value;
            if (isPreview && !visibleRange.contains(sel)) {
                if (sel.start.isAfter(visibleRange.end)) {
                    // The selections are sorted, so the for loop can stop after encountering the first selection outside the visible range
                    break;
                }
                // skip preview of invisible parts
                continue;
            }

            if (deleteBeforeInsert) {
                let dChar = length(initSel);
                let r = new vscode.Range(sel.start.translate(0, +dChar), sel.end);
                // r.start !== initSel.end (not always equal)
                if (sel.isEmpty) {
                    if (lastLine !== sel.start.line) {
                        curCharDelta = 0;
                    }
                    // If the selection is empty, it is in cursor mode
                    // The selection is a zero-size selection and moves after insert
                    r = r.with(initSel.end.translate(0, +curCharDelta), sel.end);
                    curCharDelta += r.end.character - r.start.character;
                    lastLine = sel.start.line;
                }
                builder.delete(r);
            }

            // `delete` + `insert` should be equal to one `replace` call
            // But when two selections overlap, vscode automatically merges them (which reduces the total number of selections),
            // so here we separate delete and insert calls instead.
            builder.insert(sel.end, (val === undefined || val === null) ? '' : fmt(val));
        }
    }, option);
}

export function highlightPreview(editor: vscode.TextEditor, initialSelections: vscode.Selection[]) {
    let lastLine = -1;
    let curCharDelta = 0; // records the number of character delted so far on current line
    const cursel = [...editor.selections].sort(sortSelection);
    let selectionsInRange = cursel.map((sel, i) => {
        const initSel = initialSelections[i];
        let dChar = length(initSel);
        // Same as above
        let r = new vscode.Range(sel.start.translate(0, +dChar), sel.end);
        if (sel.isEmpty) {
            if (lastLine !== sel.start.line) {
                curCharDelta = 0;
            }
            r = r.with(initSel.end.translate(0, +curCharDelta), sel.end);
            curCharDelta += r.end.character - r.start.character;
            lastLine = sel.start.line;
        }
        return r;
    });
    editor.setDecorations(sequenceInsertionDecorationType, selectionsInRange);
}

export async function insertNLines(nlines: string, editor: vscode.TextEditor) {
    const nLinesToInsert = parseInt(nlines);
    let eol = '\n';
    switch (editor.document.eol) {
        case vscode.EndOfLine.CRLF:
            eol = '\r\n';
            break;
        case vscode.EndOfLine.LF:
            break;
    }
    eol = eol.repeat(nLinesToInsert);
    await editor.edit((builder) => {
        editor.selections.forEach(selection => {
            builder.insert(selection.end, eol);
        });
    });
    let newSel = [...editor.selections];
    for (const oldSel of editor.selections) {
        for (let i = oldSel.end.line - nLinesToInsert + 1, end = oldSel.end.line; i < end; i++) {
            newSel.push(new vscode.Selection(i, 0, i, 0));
        }
    }
    editor.selections = newSel;
}

function sortSelection(a: vscode.Selection, b: vscode.Selection): number {
    return (
        a.anchor.line - b.anchor.line || a.anchor.character - b.anchor.character
    );
}

function length(p: vscode.Selection) {
    return p.end.character - p.start.character;
}


