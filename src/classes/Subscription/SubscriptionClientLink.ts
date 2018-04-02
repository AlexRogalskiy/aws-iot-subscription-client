import { ApolloLink, NextLink, Operation, FetchResult, Observable, createOperation } from "apollo-link";
import { SubscriptionClient } from "./SubscriptionClient";
import * as aws from "aws-sdk";
import { DocumentNode, getOperationAST } from 'graphql';
import { Specific, isASubscriptionOperation } from "./Utils";
import { MqttClient } from "../MqttClients";
import gql from "graphql-tag";
import { MqttConnectOptions } from "../../types";
import { Subscription } from "./Subscription";

let obss: any [] = [];

export class SubscriptionClientLink extends ApolloLink {
    private client: SubscriptionClient;

    private connected: boolean = false;

    constructor() {
        super();
        this.client = new SubscriptionClient(MqttClient(false));
    }

    /*
        1. If operation is not subscription => forward to the next link
        2. If subscription client is not connected => connect
        3. Forward operation to the next link. Server should process subscription data. (save in redis and so on)
        4. Subscribe on cloud subscrption client
        5. Return observable
    */
    request(operation: Operation, forwardedLink: NextLink): Observable<FetchResult> {

        if (!isASubscriptionOperation(operation.query, operation.operationName)) {
            return forwardedLink(operation);
        }

        if (!this.client.isConnected) {
            this.connect(operation, forwardedLink);
        }

        return this.subscribe(operation, forwardedLink);
    }

    private subscribe(operation: Operation, forwardedLink: NextLink) {

        return new Observable( subscriber => {
            this.subscribeServer(operation, forwardedLink)
                .then((subscription: Subscription) => this.client.subscribe(subscription, subscriber))
                .catch((err: Error) => subscriber.error(err));
        });
    }

    private async subscribeServer(operation: Operation, forwardedLink: NextLink): Promise<Subscription> {
        return (new Promise<Subscription>((resolve, reject) => {
            forwardedLink(operation).subscribe({
                next: ({ data }: any) => {
                    const action = (data: any) => { return Object.keys(data)[0]; };
                    resolve(Specific.SubscriptionFromOperation(action(data), operation));
                },
                complete: () => { },
                error: (err: Error) => {
                    console.log(err.message);
                    reject(err);
                }
            });
        }));
    }

    private connect(operation: Operation, forwardedLink: NextLink) {
        const query = {
            query: gql(`
                query {
                    subscriptionConnectData {
                        accessKeyId, region, refreshToken, secretKey, iotEndpoint
                    }
                }`)
        };

        forwardedLink(createOperation(operation.getContext(), query)).subscribe({
            next: ({ data } ) =>  this.client.connect(<MqttConnectOptions>data.subscriptionConnectData),
            complete: () => { },
            error: (err: Error) => {
                console.log(err);
            }
        });
    }


}

