import { EventEmitter } from 'events'
import { ResultProvider } from 'marklogic'
import { LaunchRequestArguments, XqyFrame } from './xqyDebug'
import { sendXQuery, MarklogicClient, MlClientParameters } from '../client/marklogicClient'

export interface XqyBreakPoint {
    uri: string;
    line: number;
    column?: number;
    condition?: string;
    expr?: number;
}



export class XqyRuntime extends EventEmitter {

    private _mlClient: MarklogicClient
    private _rid = ''
    private _timeout = 1

    public constructor() {
        super()
    }

    private _runTimeState: 'shutdown' | 'launched' | 'attached' | 'error' = 'shutdown';

    public getRunTimeState(): 'shutdown' | 'launched' | 'attached' | 'error' {
	    return this._runTimeState
    }

    public setRunTimeState(state: 'shutdown' | 'launched' | 'attached'): void {
        this._runTimeState = state
    }

    public launchWithDebugEval(query: string): Promise<void> {
        return sendXQuery(this._mlClient, query, 'dbg')
            .result(
                (fulfill: Record<string, any>) => {
                    console.log('fulfill (dbg): ' + JSON.stringify(fulfill))
                    this._rid = fulfill[0]['value']
            	    this.setRunTimeState('launched')
                },
                (error: Record<string, any>) => {
                    console.log('error (dbg): ' + JSON.stringify(error))
                    this._runTimeState = 'error'
                })
    }

    public initialize(args: LaunchRequestArguments): void {
        this._mlClient = new MarklogicClient(args.clientParams)
    }

    public setRid(rid: string): void {
        this._rid = rid
    }

    public getRid(): string {
        return this._rid
    }

    public resume(): ResultProvider<Record<string, any>> {
	    return sendXQuery(this._mlClient, `dbg:continue(${this._rid})`)
    }

    public stepOver(): ResultProvider<Record<string, any>> {
        return sendXQuery(this._mlClient, `dbg:next(${this._rid})`)
    }

    public stepInto(): ResultProvider<Record<string, any>> {
        return sendXQuery(this._mlClient, `dbg:step(${this._rid})`)
    }

    public stepOut(): ResultProvider<Record<string, any>> {
        return sendXQuery(this._mlClient, `dbg:out(${this._rid})`)
    }

    public getStackTrace(): ResultProvider<Record<string, any>> {
        return sendXQuery(this._mlClient, `dbg:stack(${this._rid})`)
    }

    private findBreakPointExpr(location: XqyBreakPoint): Promise<number> {
        return sendXQuery(this._mlClient, `dbg:line(${this._rid}, ${location.uri}, ${location.line})`)
            .result((fulfill: Record<string, any>[]) => {
                location.expr = fulfill['value'][0]
                return fulfill['value'][0]
            })
    }

    public setBreakPoint(location: XqyBreakPoint): Promise<void> {
        if (!location.expr) {
            return this.findBreakPointExpr(location).then((expr: number) => {
                sendXQuery(this._mlClient, `dbg:break(${this._rid}, ${expr})`)
                    .result(
                        (fulfill: Record<string, any>[]) => {
                            console.info('fulfull: ' + JSON.stringify(fulfill))
                        },
                        (error: Record<string, any>[]) => {
                            console.info('error: ' + JSON.stringify(error))
                        })
            })
        } else {
            return sendXQuery(this._mlClient, `dbg:break(${this._rid}, ${location.expr})`)
                .result(
                    (fulfill: Record<string, any>[]) => {
                        console.info('fulfill: ' + JSON.stringify(fulfill))
                    },
                    (error: Record<string, any>[]) => {
                        console.error('errro: ' + JSON.stringify(error))
                    }
                )
        }
    }

    public removeBreakPoint(location: XqyBreakPoint): Promise<void> {
        if (!location.expr) {
            return this.findBreakPointExpr(location).then((expr: number) => {
                sendXQuery(this._mlClient, `dbg:clear(${this._rid}, ${expr})`)
                    .result(
                        (fulfill: Record<string, any>[]) => {
                            console.info('fulfill: ' + JSON.stringify(fulfill))
                        },
                        (error: Record<string, any>[]) => {
                            console.error('errro: ' + JSON.stringify(error))
                        }
                    )
            })
        } else {
            return sendXQuery(this._mlClient, `dbg:clear(${this._rid}, ${location.expr})`)
                .result(
                    (fulfill: Record<string, any>[]) => {
                        console.info('fulfill: ' + JSON.stringify(fulfill))
                    },
                    (error: Record<string, any>[]) => {
                        console.error('errro: ' + JSON.stringify(error))
                    }
                )
        }
    }

    public wait(): ResultProvider<Record<string, any>> {
        return sendXQuery(this._mlClient, `dbg:wait(${this._rid}, 5)`)
    }

    public evaluateInContext(expr: string, cid?: string): ResultProvider<Record<string, any>> {
        return sendXQuery(this._mlClient, `dbg:value(${this._rid}, ${expr})`)
    }

    public async getProperties(objectId: string): Promise<string> {
        return 'not yet implemented'
    }

    public disable(): ResultProvider<Record<string, any>> {
        return sendXQuery(this._mlClient, `dbg:value(${this._rid})`)
    }

    public terminate(): ResultProvider<Record<string, any>> {
        return sendXQuery(this._mlClient, 'dbg:disconnent(xdmp:server())')
    }

    public parseStackXML(stackXML): Array<XqyFrame> {
        return []
    }

    public async getCurrentStack(): Promise<string> {
        return sendXQuery(this._mlClient, `dbg:stack(${this._rid})`).result(
            (fulfill: Record<string, any>) => {
                // TODO: parse frameXML into stack
                console.info('stack: ' + JSON.stringify(fulfill))
                return JSON.stringify(fulfill)
            },
            (error: Record<string, any>) => {
                console.info('error (stack): ' + JSON.stringify(error))
            })
    }
}
