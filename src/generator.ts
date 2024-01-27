export class PrevSequenceGen implements Iterator<unknown, unknown, unknown> {
    constructor(private value: unknown, private stepFunc: StepFunction) {
    }
    // Calculates next value based on the previous value
    public next(index: number): IteratorResult<unknown> {
        const value = this.value;
        this.value = this.stepFunc(this.value, index);
        return {
            done: false,
            value
        };
    }
}

export class IndexSequenceGen implements Iterator<unknown, unknown, unknown> {
    constructor(private value: unknown, private stepFunc: StepFunction) {
    }
    // Calculates next value based on the index
    public next(index: number): IteratorResult<unknown> {
        this.value = this.stepFunc(this.value, index);
        return {
            done: false,
            value: this.value
        };
    }
}

// Spreadsheet column
export function fromSpreadSheet(s: string) {
    let ret = 0;
    s = s.toLowerCase();
    const n = s.length;
    for (let i = 0; i < n; i++) {
        ret = ret * 26 + (s.charCodeAt(i) - 96);
    }
    return ret;
}

export function toSpreadSheet(n: number, lower: boolean = true) {
    let ret = '';
    // without n--, f(0) == 'A'
    // use n-- to make g(1) == 'A'
    n--;
    const offset = lower ? 97 : 65; // 'a' or 'A'
    for (; n >= 0; n = Math.floor(n / 26) - 1) {
        ret = String.fromCharCode(n % 26 + offset) + ret;
    }
    return ret;
}