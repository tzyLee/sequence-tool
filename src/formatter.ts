import { format } from 'path';
import { toSpreadSheet } from './generator';
import { isNumber } from "./utils";

export const defaultFormatter: Formatter = (n: unknown) => n !== null && n !== undefined ? n.toString().replace(/[\r\n]/g, '') : '';
export const SpreadSheetFormatter = (lower: boolean) => {
    return ((n: unknown) => isNumber(n) ? toSpreadSheet(n, lower) : '') as Formatter;
};
export const NumberLetterBaseFormatter = (base: number) => {
    return ((n: unknown) => isNumber(n) ? Math.trunc(n).toString(base).toUpperCase() : '') as Formatter;
};

export const NumberBaseFormatter = (base: number) => {
    return ((n: unknown) => isNumber(n) ? Math.trunc(n).toString(base) : '') as Formatter;
};

export const TwosComplementFormatter = (bitwidth: number) => {
    const N = 2 ** bitwidth;
    return ((n: unknown) => {
        if (!isNumber(n)) {
            return '';
        }
        let nint = Math.trunc(n);
        let fillChar = '0';
        if (nint < 0) {
            nint = N + nint;
            fillChar = '1';
        }
        return nint.toString(2).padStart(bitwidth, fillChar);
    }) as Formatter;
};
export const charCodeFormatter: Formatter = (n: unknown) => isNumber(n) ? String.fromCodePoint(n).replace(/[\r\n]/g, '') : '';
export const FloatFormatter = (precision: number) => {
    return ((n: unknown) => isNumber(n) ? n.toFixed(precision) : '') as Formatter;
};
export const PaddingFormatter = (padLeft: boolean, width: number, fill: string, prevFormatter: Formatter) => {
    return ((n: unknown) => padLeft ?
        prevFormatter(n).padStart(width, fill) :
        prevFormatter(n).padEnd(width, fill)
    ) as Formatter;
}


