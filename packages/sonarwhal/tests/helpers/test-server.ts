/**
 * @fileoverview Simple HTTP server used in sonarwhal's tests to mimick certain scenarios.
 */
import * as fs from 'fs-extra';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';

import * as _ from 'lodash';
import * as express from 'express';
import * as onHeaders from 'on-headers';

import { getHeaderValueNormalized, normalizeString } from '../../src/lib/utils/misc';

export type ServerConfiguration = string | object; //eslint-disable-line

const maxPort = 65535;

/** A testing server for sonarwhal's rules */
export class Server {
    private _app;
    private _server: https.Server | http.Server;
    private _port: number = _.random(3000, 65000);
    private _isHTTPS: boolean;

    public constructor(isHTTPS?: boolean) {
        this._app = express();
        this._app.disable('x-powered-by');
        this._app.use((req, res, next) => {
            res.setHeader('Cache-Control', 'no-cache');
            next();
        });
        this._isHTTPS = isHTTPS;
    }

    /**
     * Because we don't know the port until we start the server, we need to update
     * the references to http://localhost in the HTML to http://localhost:finalport.
     */
    private updateLocalhost(html: string): string {
        return html.replace(/\/\/localhost\//g, `//localhost:${this._port}/`);
    }

    private handleHeaders(res, headers) {
        onHeaders(res, () => {
            Object.entries(headers).forEach(([header, value]) => {
                if (value !== null) {
                    res.setHeader(header, value);
                } else {
                    res.removeHeader(header);
                }
            });
        });
    }

    private getContent(value): string {
        if (typeof value === 'string') {
            return this.updateLocalhost(value);
        } else if (value && typeof value.content !== 'undefined') {
            return typeof value.content === 'string' ? this.updateLocalhost(value.content) : value.content;
        }

        return '';
    }

    private getNumberOfMatches(req, requestConditions) {
        const headers = requestConditions.request && requestConditions.request.headers;

        /*
         * Matching is done only based on headers, as for the time
         * beeing there is no need to match based on other things.
         */

        if (!headers) {
            return 0;
        }

        let numberOfMatches = 0;

        for (const [header, value] of Object.entries(headers)) {
            const headerValue = getHeaderValueNormalized(req.headers, header);

            if ((headerValue !== normalizeString(value as string)) || (!headerValue && (value === null))) {
                return 0;
            }

            numberOfMatches++;
        }

        return numberOfMatches;
    }

    private getValue(req, config) {
        let bestNumberOfMatches = 1;
        let bestMatch = null;

        for (const [key, value] of Object.entries(config)) {
            let requestConditions;

            try {
                requestConditions = JSON.parse(key);

                const newNumberOfMatches = this.getNumberOfMatches(req, requestConditions);

                if (newNumberOfMatches >= bestNumberOfMatches) {
                    bestMatch = value;
                    bestNumberOfMatches = newNumberOfMatches;
                }

            } catch (e) {
                // Ignore invalid keys.
            }
        }

        return bestMatch;
    }

    private isConditionalConfig(configuration): boolean {
        /*
         * The following is done to quickly determine the type of
         * configuration. Possible options are:
         *
         * 1) Simple config
         *    (server response is always the same)
         *
         *     {
         *          name: ...,
         *          reports: [{ message: ... }],
         *          serverConfig: {
         *              '/': {
         *                  content: ...,
         *                  headers: ...
         *              },
         *              ...
         *          }
         *      }
         *
         *
         * 2) Conditional config
         *    (server response depends on the request)
         *
         *      {
         *          name: ...
         *          reports: [{ message: ... }],
         *          serverConfig: {
         *              [JSON.stringify({
         *                  headers: {
         *                      ...
         *                  }
         *              })]: {
         *                  '/': {
         *                      content: ...,
         *                      headers: ...
         *                  },
         *             },
         *             ...
         *          }
         *      }
         */

        try {
            return typeof JSON.parse(Object.entries(configuration)[0][0]) === 'object';
        } catch (e) {
            // Ignore.
        }

        return false;
    }

    private normalizeConfig(configuration) {
        const config = {};

        /*
         * This function convers something such as:
         *
         *  {
         *      '{"request":{"headers":{"Accept-Encoding":"gzip"}}}': {
         *          '/': {
         *              content: ...
         *              headers: ...
         *          },
         *          ...
         *      }
         *      '{"request":{"headers":{"Accept-Encoding":"br"}}}': {
         *          '/': {
         *              content: ...
         *              headers: ...
         *          },
         *          ...
         *      }
         *      ...
         *  }
         *
         *  to
         *
         *  {
         *      '/': {
         *          '{"request":{"headers":{"Accept-Encoding":"gzip"}}}': {
         *              content: ...
         *              headers: ...
         *          },
         *          '{"request":{"headers":{"Accept-Encoding":"br"}}}': {
         *              content: ...
         *              headers: ...
         *          },
         *          ...
         *      }
         *      ...
         *  }
         *
         */

        for (const [k, v] of Object.entries(configuration)) {
            for (const [key, value] of Object.entries(v)) {
                config[key] = Object.assign({}, config[key], { [k]: value });
            }
        }

        return config;
    }

    /** Applies the configuration for routes to the server. */
    public configure(configuration: ServerConfiguration) {
        let customFavicon = false;

        if (typeof configuration === 'string') {
            this._app.get('/', (req, res) => {
                res.send(configuration);
            });

            return;
        }

        const conditionalConfig = this.isConditionalConfig(configuration);
        const config = conditionalConfig ? this.normalizeConfig(configuration) : configuration;

        _.forEach(config, (val, key) => {
            customFavicon = customFavicon || key === '/favicon.ico';

            this._app.get(key, (req, res) => {

                const value = conditionalConfig ? this.getValue(req, val) : val;
                const content = this.getContent(value);

                /*
                 * Hacky way to make `request` fail, but required
                 * for testing cases such as the internet connection
                 * being down when a particular request is made.
                 */

                if (value === null) {
                    res.redirect(301, 'test://fa.il');

                    return;
                }

                const redirects = [301, 302, 303, 307, 308];

                if (value && redirects.includes(value.status)) {
                    res.redirect(value.status, content);

                    return;
                }

                if (value && value.status) {
                    res.status(value.status);
                }

                if (value && value.headers) {
                    this.handleHeaders(res, value.headers);
                }

                if (content !== 'timeout') { // if `content === 'timeout'`, leaves the server hanging to test the implementation of timeout.
                    res.send(content);
                }
            });
        });

        if (!customFavicon) {
            this._app.get('/favicon.ico', (req, res) => {
                res.status(200);
                res.setHeader('Content-Length', '0');
                res.setHeader('Content-Type', 'image/x-icon');
                res.end();
            });
        }
    }

    /** Starts listening on the given port. */
    public start() {
        return new Promise(async (resolve, reject) => {
            let options;

            if (this._isHTTPS) {
                options = {
                    cert: await fs.readFile(path.join(__dirname, 'fixture/server.crt'), 'utf8'),
                    key: await fs.readFile(path.join(__dirname, 'fixture/server.key'), 'utf8')
                };

                this._server = https.createServer(options, this._app);
            } else {
                this._server = http.createServer(this._app);
            }

            // TODO: need to find a way to cast `err` to a [System Error](https://nodejs.org/dist/latest-v7.x/docs/api/errors.html#errors_system_errors)
            this._server.on('error', (err: any) => {
                console.error(err.code);

                if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                    setImmediate(() => {
                        this._port++;
                        if (this._port > maxPort) {
                            this._port = _.random(3000, 65000);
                        }
                        this._server.close();
                        this._server.listen(this._port);
                    });
                } else {
                    reject(err);
                }
            });

            this._server.once('listening', () => {
                resolve();
            });

            this._server.listen(this._port);
        });
    }

    /** Stops the server and frees the port. */
    public stop() {
        this._server.close();
    }

    public get port() {
        return this._port;
    }
}

/** Returns a testing server */
export const createServer = (isHTTPS?: boolean) => {
    return new Server(isHTTPS);
};
