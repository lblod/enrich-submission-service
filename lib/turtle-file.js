import {graph, parse} from 'rdflib';
import fs from "fs-extra";

const MIME_TYPE = 'text/turtle';

export class TurtleFile {

    constructor({uri}) {
        this.uri = uri;
        this.graph = graph();
    }

    get path() {
        return this.uri.replace('share://', '/share/');
    }

    read() {
        const body = fs.readFileSync(this.path, 'utf-8');
        parse(body, this.graph, this.uri , MIME_TYPE);
        return this;
    }

    match(s, p, o) {
        return this.graph.match(s, p, o);
    }
}