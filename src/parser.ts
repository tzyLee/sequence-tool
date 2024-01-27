import * as vscode from "vscode";
import { PrevSequenceGen, IndexSequenceGen, fromSpreadSheet } from './generator';
import * as formatters from './formatter';
import { isNumber } from "./utils";

export const formatPrompt = 'format: [[fillChar][align][width][.prec][spec] ","][init]["," [expr]]';

export function parseCommand(v: string): [SequenceGen | null, Formatter, vscode.InputBoxValidationMessage | string] {
    let fmt = formatters.defaultFormatter;
    if (!v) {
        // initial empty input won't reach here,
        // clear the previews after input box is empty
        return [null, fmt, { message: 'Input is empty', severity: vscode.InputBoxValidationSeverity.Info }];
    }
    const match = (/^(?:(?:(?<fillChar>.)(?<align>[<>]))?(?<fillZero>0)?(?<width>[1-9]\d*)?(?:\.(?<precision>\d+))?(?<spec>[bodhxHXfc])?(?:b(?<base>\d+))?,)?(?:(?<init>[^,]+)?(?:,(?<expr>.+))?)?$/).exec(v);
    let init: any = 0;
    let stepFunc = (p: unknown, i: number) => isNumber(p) ? p + 1 : 0;
    let constructor: SequenceGenConstructor = PrevSequenceGen;
    if (!match) {
        return [new constructor(init, stepFunc), fmt, { message: `The command does not match the ${formatPrompt}`, severity: vscode.InputBoxValidationSeverity.Warning }];
    }
    let formatCmd = 'default';
    let initCmd = '0';
    let exprCmd = '(p, i) => p+1';
    let inferredPrecision = 0;
    // groups is not null if there exists any named group
    const groups = match.groups!;

    try {
        if (groups.expr) {
            stepFunc = (0, eval)(`(function (p,i) { return (${groups.expr}); })`);
            exprCmd = `(p,i) => ${groups.expr}`;
            // Infer precision from step
            if ((!groups.spec || groups.spec === 'f' && !groups.precision)) {
                for (const m of groups.expr.matchAll(/\bp[+-](?:\d*\.(?<frac1>\d+)|\d+\.(?<frac2>\d*))\b/g)) {
                    if (m?.groups) {
                        groups.spec = 'f';
                        inferredPrecision = Math.max(inferredPrecision, (m.groups?.frac1?.length ?? m.groups?.frac2?.length ?? 0));
                    }
                }
            }
        }
        if (groups.init) {
            const numMatch = /^[+-]?(?:\d+|\d*\.(?<frac1>\d+)|\d+\.(?<frac2>\d*))(?:[Ee][+-]?\d+)?$/.exec(groups.init);
            if (numMatch) {
                init = parseFloat(groups.init);
                initCmd = groups.init;
                // Infer precision from initial value
                if ((!groups.spec || groups.spec === 'f' && !groups.precision)) {
                    // numMatch can match a non-fraction number
                    if (numMatch?.groups?.frac1 || numMatch?.groups?.frac2) {
                        groups.spec = 'f';
                        inferredPrecision = Math.max(inferredPrecision, (numMatch.groups?.frac1?.length ?? numMatch.groups?.frac2?.length ?? 0));
                    }
                }
            }
            else if (/^[a-zA-Z]+$/.test(groups.init)) {
                init = fromSpreadSheet(groups.init);
                initCmd = `letter"${groups.init}"`;
                fmt = formatters.SpreadSheetFormatter(/^[a-z]$/.test(groups.init[0]));
            }
            else {
                try {
                    init = (0, eval)(groups.init);
                    initCmd = `expr"${groups.init}"`;
                } catch (e) {
                    if (groups.init.length === 1) {
                        init = groups.init.codePointAt(0);
                        initCmd = `unicode"${groups.init}"`;
                    } else {
                        initCmd = `unk"${groups.init}"=0`;
                    }
                }
            }
        } else {
            if (groups.expr && !/\bp\b/.test(groups.expr)) {
                // Use index gen if there's no inital value and the expression does not contain p
                init = stepFunc(0, 0);
                initCmd = init.toString();
                constructor = IndexSequenceGen;
            }
        }
    } catch (e: any) {
        return [null, fmt, { message: `Command: [${formatCmd}] , [${initCmd}] , [${exprCmd}] Invalid function string: "${e?.message ?? v}"`, severity: vscode.InputBoxValidationSeverity.Warning }];
    }

    // base conversion: only supports integer
    if (groups.spec !== 'c' && groups.spec !== 'f' && groups.spec || groups.base) {
        let base = 10;
        const gbase = parseInt(groups.base);
        switch (groups.spec) {
            case 'b': base = 2; break;
            case 'o': base = 8; break;
            case 'd': base = 10; break;
            case 'X': case 'H': case 'x': case 'h': base = 16; break;
            default: if (gbase) {
                base = gbase;
            }
        }
        base = Math.max(2, Math.min(36, base));
        if (groups.spec && groups.spec === groups.spec.toUpperCase()) {
            // For X and H
            fmt = formatters.NumberLetterBaseFormatter(base);
        } else {
            fmt = formatters.NumberBaseFormatter(base);
        }
        formatCmd = `base=${base}`;
    }
    // charcode
    if (groups.spec === 'c') {
        fmt = formatters.charCodeFormatter;
        formatCmd = `spec=char`;
    }
    // precision: only supports decimal floating point
    if (groups.spec === 'f') {
        let precision = inferredPrecision || 6;
        const gprec = parseInt(groups.precision);
        if (gprec) {
            precision = gprec;
        }
        fmt = formatters.FloatFormatter(precision);
        formatCmd = `precision=${precision}f`;
    }
    if (groups.fillZero && !groups.fillChar) {
        groups.fillChar = groups.fillZero;
    }
    // padding occurs after the number is formatted
    if (groups.width) {
        let padLeft = true;
        let fill = ' ';
        let width: number | undefined = undefined;
        if (groups.align === '<') {
            padLeft = false;
        }
        if (groups.width) {
            width = parseInt(groups.width);
            fill = groups.fillChar || ' ';
            fmt = formatters.PaddingFormatter(padLeft, width!!, fill, fmt);
        }
        const padCmd = `${fill}${padLeft ? '>' : '<'}${width !== undefined ? width : ''}`;
        formatCmd = formatCmd ? `${padCmd},${formatCmd}` : padCmd;
    }
    // 2's complement
    if (groups.spec === 'b' && groups.width && groups.fillChar === '0' && groups.align !== '<') {
        const bitwidth = parseInt(groups.width);
        fmt = formatters.TwosComplementFormatter(bitwidth);
        formatCmd = `0>${groups.width},2's`;
    }
    return [new constructor(init, stepFunc), fmt, { message: `Command: [${formatCmd}] , [${initCmd}] , [${exprCmd}]`, severity: vscode.InputBoxValidationSeverity.Info }];
}

