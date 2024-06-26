/*
 * Copyright (c) 2023 MarkLogic Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

import * as fs from 'fs';
import * as ml from 'marklogic';

import { ClientFactory } from './clientFactory';
import { MlxprsStatus } from './mlxprsStatus';

export const MLDBCLIENT = 'mldbClient';
export const MLSETTINGSFLAG = /mlxprs:settings/;
export const XQY = 'xqy';
export const SJS = 'sjs';

export interface ServerQueryResponse {
    name: string;
    id: string;
    port?: number;
}

export interface ResourceResponse {
    config: ResourceConfig[];
}

export interface PropertiesResponse {
    config: PropertiesConfig[];
}

interface ResourceConfig {
    database: Resource[];
    server: Resource[];
}

interface Resource {
    name: string;
    id: number;
}

interface PropertiesConfig {
    server: AppServerProperties[];
}

interface AppServerProperties {
    'server-name': string;
    port: number;
}

export class MlClientParameters {
    contentDb: string;
    modulesDb: string;
    host: string;
    port: number;
    managePort?: number;
    adminPort?: number;
    testPort?: number;
    user: string;
    pwd: string;
    authType: string;
    apiKey: string;
    accessTokenDuration: number;
    ssl: boolean;
    pathToCa: string;
    rejectUnauthorized: boolean;
    manageBasePath?: string;
    adminBasePath?: string;
    restBasePath?: string;
    testBasePath?: string;
    /**
     * note: defaults not applied here. Properties can remain undefined so that
     *       per-query overrides don't clobber the existing config with default values.
     *       (using the spread operator in `getDbClient`)
     **/
    constructor(rawParams: Record<string, any>) {
        this.host = rawParams.host;
        this.port = Number(rawParams.port);
        this.restBasePath = rawParams.restBasePath || '';
        this.managePort = Number(rawParams.managePort) || ClientContext.DEFAULT_MANAGE_PORT;
        this.manageBasePath = rawParams.manageBasePath || '';
        this.adminPort = Number(rawParams.adminPort) || ClientContext.DEFAULT_ADMIN_PORT;
        this.adminBasePath = rawParams.adminBasePath || '';
        this.testPort = Number(rawParams.testPort);
        this.testBasePath = rawParams.testBasePath || '';
        this.user = rawParams.user;
        this.pwd = rawParams.pwd;
        this.contentDb = rawParams.contentDb || rawParams.documentsDb || '';
        this.modulesDb = rawParams.modulesDb || '';
        this.authType = rawParams.authType;
        this.apiKey = rawParams.apiKey;
        this.accessTokenDuration = rawParams.accessTokenDuration;
        this.ssl = Boolean(rawParams.ssl);
        this.pathToCa = rawParams.pathToCa || '';
        this.rejectUnauthorized = Boolean(rawParams.rejectUnauthorized);

        // This check was previously done in the MarklogicClient constructor, but doing so causes the sameAs
        // function in this class to not behave properly
        if (this.authType !== 'DIGEST' && this.authType !== 'BASIC' && this.authType !== 'CLOUD') {
            this.authType = 'DIGEST';
        }
    }

    toString(): string {
        const paramsArray = [
            this.host, this.port, this.user, this.pwd.replace(/./g, '*'),
            this.authType, this.contentDb, this.modulesDb,
            this.apiKey, this.accessTokenDuration
        ];
        if (this.ssl) {
            paramsArray.push('ssl');
            if (!this.rejectUnauthorized) paramsArray.push('insecure');
            if (this.pathToCa) paramsArray.push('pathToCa:' || this.pathToCa);
        } else {
            paramsArray.push('plaintext');
        }
        return paramsArray.join(':');
    }

    sameAs(other: MlClientParameters): boolean {
        return (
            this.host === other.host &&
            ((isNaN(this.port) && isNaN(other.port)) || this.port === other.port) &&
            this.contentDb === other.contentDb &&
            this.modulesDb === other.modulesDb &&
            this.user === other.user &&
            this.pwd === other.pwd &&
            this.authType === other.authType &&
            this.apiKey === other.apiKey &&
            this.accessTokenDuration === other.accessTokenDuration &&
            this.ssl === other.ssl &&
            this.pathToCa === other.pathToCa &&
            this.rejectUnauthorized === other.rejectUnauthorized
        );
    }
}

export class ClientContext {
    public static DEFAULT_MANAGE_PORT = 8002;
    public static DEFAULT_ADMIN_PORT = 8001;
    params: MlClientParameters;
    ca: string;

    databaseClient: ml.DatabaseClient;
    constructor(params: MlClientParameters) {
        this.params = params;
        this.params.authType = params.authType.toUpperCase();

        if ((params.pathToCa) && (params.pathToCa !== '')) {
            try {
                this.ca = fs.readFileSync(this.params.pathToCa, 'utf8');
            } catch (e) {
                throw new Error('Error reading CA file: ' + e.message);
            }
        }
        if (!this.params.contentDb) {
            this.params.contentDb = null;
        }
        this.databaseClient = ml.createDatabaseClient({
            host: this.params.host, port: this.params.port, basePath: this.params.restBasePath,
            user: this.params.user, password: this.params.pwd,
            database: this.params.contentDb,
            authType: this.params.authType, ssl: this.params.ssl,
            apiKey: this.params.apiKey, accessTokenDuration: this.params.accessTokenDuration,
            ca: this.ca, rejectUnauthorized: this.params.rejectUnauthorized
        });
    }

    toString(): string {
        return this.params.toString();
    }

    hasSameParamsAs(newParams: MlClientParameters): boolean {
        return this.params.sameAs(newParams);
    }

    async getConnectedServers(
        requestingObject: MlxprsStatus | null,
        managePort: number,
        manageBasePath: string,
        updateCallback: (connectedServers: string[]) => void
    ): Promise<string[]> {
        const overrides: Record<string, any> = {
            password: this.params['pwd'],
            managePort: managePort,
            manageBasePath: manageBasePath
        };
        const clientFactory = new ClientFactory({ ...this.params, ...overrides });
        const connectedJsServers: MlxprsQuickPickItem[] =
            await getFilteredListOfJsAppServers(clientFactory, 'true');
        return this.databaseClient.xqueryEval('xquery version "1.0-ml"; dbg:connected()')
            .result(
                async (items: ml.Item[]) => {
                    const connectedServers: string[] = [];
                    const requests = [];
                    items.forEach(async (item) => {
                        requests.push(
                            sendXQuery(this, `xdmp:server-name(${item.value})`)
                                .result(
                                    (result: ml.Item[]) => {
                                        connectedServers.push('XQY:' + result[0].value);
                                    },
                                    err => {
                                        return [];
                                    })
                        );
                    });
                    await Promise.all(requests);

                    connectedJsServers.forEach((quickPickItem) => {
                        connectedServers.push('JS:' + quickPickItem.label);
                    });
                    if (updateCallback) {
                        updateCallback.call(requestingObject, connectedServers);
                    }
                    return connectedServers;
                },
                (err) => {
                    throw err;
                }
            );
    }

    public listServersForDisconnectQuery = `
    let $connected-app-servers := dbg:connected()
    let $json-servers := $connected-app-servers ! (map:new()
      => map:with("id", .)
      => map:with("name", xdmp:server-name(.))
      => map:with("port", xdmp:server-port(.)))
    => xdmp:to-json()
    return $json-servers
    `;

    public buildListServersForConnectQuery() {
        return `
let $all-app-servers := xdmp:servers()
let $connected-app-servers := dbg:connected()
let $not-connected-app-servers :=
  for $app-server in $all-app-servers
  return
    if ($app-server = $connected-app-servers) then
      ()
    else
      if (xdmp:server-name($app-server) = ('Admin', 'Manage', 'HealthCheck', 'App-Services')) then
        ()
      else
        if (xdmp:server-port($app-server) = ${this.params.port}) then
            ()
        else
            $app-server
let $json-servers := $not-connected-app-servers ! (map:new()
  => map:with("id", .)
  => map:with("name", xdmp:server-name(.))
  => map:with("port", xdmp:server-port(.)))
=> xdmp:to-json()
return $json-servers
`;
    }

    public buildAppServerChoicesFromServerList(appServers: Record<string, ServerQueryResponse>) {
        const servers: ServerQueryResponse[] = [].concat(appServers[0]['value'] || []);
        return servers
            .map((server: ServerQueryResponse) => {
                return {
                    label: server.name,
                    description: server.id,
                    detail: `${server.name} on ${this.params.host}:${server.port || '(none)'}`,
                } as any;
            });
    }

    public buildUrlBase(port?: number, basePath?: string): string {
        const targetPort = port ? port : this.params.port;
        const targetBasePath = basePath ? basePath : '';
        const scheme: string = this.params.ssl ? 'https' : 'http';
        return `${scheme}://${this.params.host}:${targetPort}${targetBasePath}`;
    }

    async executeGenericGetRequest(url: string): Promise<unknown> {
        return new Promise((resolve, reject) => {
            this.databaseClient.internal.sendRequest(
                url,
                (requestOptions: ml.RequestOptions) => {
                    requestOptions.method = 'GET';
                    requestOptions.headers = {
                        'Content-type': 'application/json'
                    };
                })
                .result((result: string) => {
                    resolve(result);
                })
                .catch((error) => {
                    reject(error);
                });
        });
    }

    async getAllProperties(): Promise<PropertiesResponse> {
        const resourcePropertiesUrl = '/manage/v3?resource-type=database,server&include-properties=true&format=json';
        return this.executeGenericGetRequest(resourcePropertiesUrl) as Promise<PropertiesResponse>;
    }

    async getAllResources(): Promise<ResourceResponse> {
        const resourcesUrl = '/manage/v3?resource-type=database,server&include-properties=false&format=json';
        return this.executeGenericGetRequest(resourcesUrl) as Promise<ResourceResponse>;
    }

}

export function parseXQueryForOverrides(queryText: string): Record<string, any> {
    let overrides: Record<string, any> = {};
    const firstContentLine: string = queryText.trim().split(/[\r\n]+/)[0];
    const startsWithComment: RegExpMatchArray = firstContentLine.match(/^\(:[\s\t]*/);
    const overridesFlagPresent: RegExpMatchArray = firstContentLine.match(MLSETTINGSFLAG);

    if (startsWithComment && overridesFlagPresent) {
        const overridePayload: string = queryText.trim()
            .match(/\(:.+:\)/sg)[0]       // take the first comment (greedy, multiline)
            .split(/:\)/)[0]              // end at the comment close (un-greedy the match)
            .replace(MLSETTINGSFLAG, '')  // get rid of the flag
            .replace(/^\(:/, '')          // get rid of the comment opener
            .trim();
        overrides = JSON.parse(overridePayload);
    }
    return overrides;
}


export function sendJSQuery(
    dbClientContext: ClientContext,
    actualQuery: string,
    sqlQuery = '',
    sqlOptions = []): ml.ResultProvider<Record<string, any>> {
    const query = `
    const options = {};
    if (modulesDb) { options.modules = xdmp.database(modulesDb) };
    if (contentDb) { options.database = xdmp.database(contentDb) };
    xdmp.eval(actualQuery,
        {actualQuery: actualQuery, sqlQuery: sqlQuery, sqlOptions: sqlOptions},
        options
        );`;

    const extVars = {
        'actualQuery': actualQuery,
        'contentDb': dbClientContext.params.contentDb,
        'modulesDb': dbClientContext.params.modulesDb,
        'sqlQuery': sqlQuery,
        'sqlOptions': sqlOptions
    } as ml.Variables;

    return dbClientContext.databaseClient.eval(query, extVars);
}


export function sendXQuery(
    dbClientContext: ClientContext,
    actualQuery: string,
    prefix: 'xdmp' | 'dbg' = 'xdmp'
): ml.ResultProvider<Record<string, any>> {
    const query =
        'xquery version "1.0-ml";' +
        'declare variable $actualQuery as xs:string external;' +
        'declare variable $contentDb as xs:string external;' +
        'declare variable $modulesDb as xs:string external;' +
        'let $options := ' +
        '<options xmlns="xdmp:eval">' +
        (dbClientContext.params.contentDb ? '<database>{xdmp:database($contentDb)}</database>' : '') +
        (dbClientContext.params.modulesDb ? '<modules>{xdmp:database($modulesDb)}</modules>' : '') +
        '</options>' +
        `return ${prefix}:eval($actualQuery, (), $options)`;
    const extVars = {
        'actualQuery': actualQuery,
        'contentDb': dbClientContext.params.contentDb,
        'modulesDb': dbClientContext.params.modulesDb
    } as ml.Variables;

    return dbClientContext.databaseClient.xqueryEval(query, extVars);
}

export function sendSparql(dbClientContext: ClientContext, sparqlQuery: string, contentType: ml.SparqlResponseFormat): ml.ResultProvider<Record<string, unknown>> {
    return dbClientContext.databaseClient.graphs.sparql({
        contentType: contentType,
        query: sparqlQuery
    });
}

export function sendGraphQl(dbClientContext: ClientContext, actualQuery: string): Promise<ml.RowsResponse> {
    return dbClientContext.databaseClient.rows.graphQL(actualQuery);
}


export function sendRows(dbClientContext: ClientContext, actualQuery: string, resultFormat: ml.RowsResponseFormat): Promise<ml.RowsResponse> {
    if (actualQuery.startsWith('{')) {
        return sendRowsSerialized(dbClientContext, actualQuery, resultFormat);
    } else {
        const queryOptions: ml.RowsOptions = { 'queryType': 'dsl', 'format': resultFormat };
        return dbClientContext.databaseClient.rows.query(actualQuery, queryOptions);
    }
}

function sendRowsSerialized(dbClientContext: ClientContext, actualQuery: string, resultFormat: ml.RowsResponseFormat): Promise<ml.RowsResponse> {
    let jsonQuery = null;
    let errObject = null;
    try {
        jsonQuery = JSON.parse(actualQuery);
    } catch (err) {
        errObject = err;
    }

    if (jsonQuery) {
        const queryOptions: ml.RowsOptions = { 'queryType': 'json', 'format': resultFormat };
        return dbClientContext.databaseClient.rows.query(jsonQuery, queryOptions);
    } else {
        return Promise.resolve(
            {
                columns: [],
                rows: [],
                preRequestError: errObject.message
            }
        );
    }
}

export interface MlxprsQuickPickItem {
    label: string;
    description: string;
    detail: string;
}

export async function getFilteredListOfJsAppServers(
    clientFactory: ClientFactory,
    requiredResponse: string
): Promise<MlxprsQuickPickItem[]> {
    const dbClientContext = clientFactory.newMarklogicRestClient();
    const listServersForConnectQuery = dbClientContext.buildListServersForConnectQuery();
    const allPossibleJsServers: MlxprsQuickPickItem[] = await getAppServerListForJs(dbClientContext, listServersForConnectQuery) as MlxprsQuickPickItem[];
    return await filterJsServerByConnectedStatus(clientFactory, allPossibleJsServers, requiredResponse);
}

export async function getAppServerListForJs(dbClientContext: ClientContext, serverListQuery: string): Promise<MlxprsQuickPickItem[]> {
    return sendXQuery(dbClientContext, serverListQuery)
        .result(
            (appServers: Record<string, ServerQueryResponse>) => {
                return dbClientContext.buildAppServerChoicesFromServerList(appServers);
            },
            err => {
                return [];
            });
}

export async function filterJsServerByConnectedStatus(
    clientFactory: ClientFactory,
    choices: MlxprsQuickPickItem[],
    requiredResponse: string
): Promise<MlxprsQuickPickItem[]> {
    const requests = [];
    const filteredChoices: MlxprsQuickPickItem[] = [];

    choices.forEach((choice) => {
        const manageClient = clientFactory.newMarklogicManageClient();
        const endpoint = `/jsdbg/v1/connected/${choice.label}`;
        const connectedRequest = manageClient.databaseClient.internal.sendRequest(
            endpoint,
            (requestOptions: ml.RequestOptions) => {
                requestOptions.method = 'GET';
            })
            .result((response: unknown) => {
                if ((response as string) === requiredResponse) {
                    filteredChoices.push(choice);
                }
            })
            .catch(error => {
                console.debug(error.body.errorResponse);
            });
        requests.push(connectedRequest);
    });
    await Promise.all(requests);
    return filteredChoices;
}

export function requestMarkLogicUnitTest(
    dbClientContext: ClientContext, testSuite: string, testFile: string
): ml.ResultProvider<unknown> {
    const endpoint = '/v1/resources/marklogic-unit-test';
    let endpointParameters = `rs:format=xml&rs:func=run&rs:suite=${encodeURIComponent(testSuite)}`;
    if (testFile) {
        endpointParameters = `${endpointParameters}&rs:tests=${encodeURIComponent(testFile)}`;
    }
    return dbClientContext.databaseClient.internal.sendRequest(
        endpoint,
        (requestOptions: ml.RequestOptions) => {
            let initialSeparator = '?';
            if (requestOptions.path.includes('?')) {
                initialSeparator = '&';
            }
            requestOptions.path = `${requestOptions.path}${initialSeparator}${endpointParameters}`;
            requestOptions.method = 'GET';
        }
    );
}