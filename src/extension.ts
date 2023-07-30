// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

type EditOption = { undoStopAfter: boolean, undoStopBefore: boolean }
type SequenceGen = Iterator<number, number, number>;
type StepFunction = (prev: number, index: number) => any;
interface SequenceGenConstructor {
	new(init: number, stepFunc: StepFunction): SequenceGen;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand(
		"sequence.insertSequence",
		async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage("Active editor not found!");
				return;
			}

			let editMade = false;
			const initialLengths = [...editor.selections].sort(sortSelection).map(s => length(s));
			const sequenceSpec = await vscode.window.showInputBox({
				title: 'Enter sequence command',
				placeHolder: 'format: [initialValue][,[(p: prev, i: index) expr]',
				async validateInput(value) {
					let [gen, msg] = getGenerator(value);
					if (!gen) {
						// clear previews when gen == null
						gen = new IndexSequenceGen(0, () => '');
					}
					// When the inputbox is active, the previews cannot be clear with 'undo' command
					// the text in the inputbox would be undoed instead
					await insertSequence(editor, initialLengths, gen, { undoStopBefore: !editMade, undoStopAfter: false }, true, editMade);
					editMade = true;
					return msg;
				}
			});

			if (sequenceSpec) {
				const [gen, _] = getGenerator(sequenceSpec);
				if (gen) {
					await vscode.commands.executeCommand('undo')
					await insertSequence(editor, initialLengths, gen, {
						undoStopBefore: false,
						undoStopAfter: true
					}, false);
				}
			} else {
				await vscode.commands.executeCommand('undo')
			}
		}
	);

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }


function getGenerator(v: string): [SequenceGen | null, vscode.InputBoxValidationMessage | string] {
	if (!v) {
		// initial empty input won't reach here,
		// clear the previews after input box is empty
		return [null, { message: 'Input is empty', severity: vscode.InputBoxValidationSeverity.Info }];
	}
	const matchResult = v.match(/^([+-]?(?:\d+|\d*\.\d+|\d+\.\d*)(?:[Ee][+-]?\d+)?)(?:,(.*))?$/);
	let init = 0;
	let stepFunc = (p: number, i: number) => p + 1;
	let Constructor: SequenceGenConstructor = PrevSequenceGen;
	try {
		if (matchResult) {
			init = parseFloat(matchResult[1]);
			if (matchResult[2]) {
				stepFunc = eval(`(function (p,i) { return (${matchResult[2]}); })`)
			}
		} else {
			stepFunc = eval(`(function (p,i) { return (${v}); })`)
			if (!/\bp\b/.test(v)) {
				init = stepFunc(0, 0);
				Constructor = IndexSequenceGen;
			}
		}
	} catch (e: any) {
		return [null, { message: e?.message ?? `Invalid function string "${v}"`, severity: vscode.InputBoxValidationSeverity.Warning }]
	}
	return [new Constructor(init, stepFunc), '']
}

function sortSelection(a: vscode.Selection, b: vscode.Selection): number {
	return (
		a.anchor.line - b.anchor.line || a.anchor.character - b.anchor.character
	);
}

async function insertSequence(editor: vscode.TextEditor, initialLengths: number[], gen: SequenceGen, option: EditOption, isPreview: boolean, deleteBeforeInsert: boolean = false) {
	return await editor.edit((builder) => {
		const selections = [...editor.selections].sort(sortSelection);
		let visibleRange = editor.visibleRanges[0];
		if (isPreview) {
			editor.visibleRanges.forEach((r) => { visibleRange = visibleRange.union(r) });
		}
		// always insert at the end of selections
		initialLengths.forEach((dChar, i) => {
			// Still calculates replacement even when the selection is out of preview range
			let val = gen.next(i).value;
			if (isPreview && !visibleRange.contains(selections[i])) {
				// skip preview of invisible parts
				return;
			}

			if (deleteBeforeInsert) {
				const r = new vscode.Range(selections[i].start.translate(0, +dChar), selections[i].end)
				builder.delete(r)
			}

			// `delete` + `insert` should be equal to one `replace` call
			// But when two selections overlap, vscode automatically merges them (which reduces the total number of selections),
			// so here we separate delete and insert calls instead.
			builder.insert(selections[i].end, (val === undefined || val === null) ? '' : val.toString())
		})
	}, option)
}

class PrevSequenceGen implements Iterator<number, number, number> {
	constructor(private value: number, private stepFunc: StepFunction) {
	}
	// Calculates next value based on the previous value
	public next(index: number): IteratorResult<number> {
		const value = this.value;
		this.value = this.stepFunc(this.value, index);
		return {
			done: false,
			value
		}
	}
}
class IndexSequenceGen implements Iterator<number, number, number> {
	constructor(private value: number, private stepFunc: StepFunction) {
	}
	// Calculates next value based on the index
	public next(index: number): IteratorResult<number> {
		this.value = this.stepFunc(this.value, index);
		return {
			done: false,
			value: this.value
		}
	}
}


function length(p: vscode.Selection) {
	return p.end.character - p.start.character
}