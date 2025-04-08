import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ReviewBotProps } from './interfaces';
import { SecretsAndParameters } from './constructs/secrets-and-parameters';
import { ReviewBotRole } from './constructs/review-bot-role';
import { StateMachineRole } from './constructs/state-machine-role';
import { LambdaLayers } from './constructs/lambda-layer';
import { ReviewBotLambda } from './constructs/lambda';
import { ReviewBotApi } from './constructs/api-gateway';
import { ReviewBotStepFunctions } from './constructs/step-functions';
import { NetworkConstruct } from './constructs/network';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class AmazonBedrockPrReviewbotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps & ReviewBotProps) {
    super(scope, id, props);

    // Create Secrets and Parameters
    const secretsAndParams = new SecretsAndParameters(this, 'SecretsAndParams', props);

    // Create Lambda Role
    const lambdaRole = new ReviewBotRole(this, 'ReviewBotRole', {
      secrets: secretsAndParams.secrets,
      region: this.region,
      account: this.account
    }).role;

    // Create Lambda Layers
    const layers = new LambdaLayers(this, 'ReviewBotLayers');

    // Create Lambda Functions
    const lambdas = new ReviewBotLambda(this, 'ReviewBotLambda', {
      role: lambdaRole,
      requestsLayer: layers.requestsLayer,
      networkxLayer: layers.networkxLayer,
      vpc: new NetworkConstruct(this, 'Network').vpc
    });

    // Create State Machine Role
    const stateMachineRole = new StateMachineRole(this, 'StateMachineRole', {
      lambdaFunctions: lambdas.functions
    }).role;

    // Create Step Functions
    const stepFunctions = new ReviewBotStepFunctions(this, 'ReviewBotStepFunctions', {
      functions: lambdas.functions,
      role: stateMachineRole
    });

    // Create API Gateway
    new ReviewBotApi(this, 'ReviewBotApi', {
      stateMachine: stepFunctions.stateMachine
    });

    // Add stack outputs
    this.addOutputs(stepFunctions);
  }

  private addOutputs(stepFunctions: ReviewBotStepFunctions) {
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stepFunctions.stateMachine.stateMachineArn,
      description: 'State Machine ARN'
    });
  }
}
