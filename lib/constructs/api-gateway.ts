import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

interface ReviewBotApiProps {
  stateMachine: stepfunctions.StateMachine;
}

export class ReviewBotApi extends Construct {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ReviewBotApiProps) {
    super(scope, id);

    // CloudWatch 로그 그룹 생성
    const logGroup = new logs.LogGroup(this, 'ApiGatewayLogs', {
      logGroupName: '/aws/apigateway/PR-Review-Bot-API',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Create API Gateway
    this.api = new apigateway.RestApi(this, 'ReviewBotApi', {
      restApiName: 'PR Review Bot API',
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL]
      },
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: false,
        // API Gateway 로깅 활성화 - 상세 커스텀 로그 형식으로 변경
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        accessLogFormat: apigateway.AccessLogFormat.custom(
          '{'
          + '"requestTime":"$context.requestTime",'
          + '"requestId":"$context.requestId",'
          + '"httpMethod":"$context.httpMethod",'
          + '"path":"$context.path",'
          + '"resourcePath":"$context.resourcePath",'
          + '"status":$context.status,'
          + '"responseLatency":$context.responseLatency,'
          + '"integrationRequestId":"$context.integration.requestId",'
          + '"functionResponseStatus":"$context.integration.status",'
          + '"integrationLatency":"$context.integration.latency",'
          + '"integrationServiceStatus":"$context.integration.integrationStatus",'
          + '"ip":"$context.identity.sourceIp",'
          + '"userAgent":"$context.identity.userAgent",'
          + '"requestBody":$input.json(\'$\'),'
          + '"responseBody":"$context.responseBody"'
          + '}'
        ),
        // 실행 로그 설정
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true, // 요청/응답 본문까지 로깅
        metricsEnabled: true,   // CloudWatch 메트릭 활성화
      }
    });

    // API Gateway 로그 쓰기 권한 IAM 정책 생성
    const apiGatewayLoggingRole = new iam.Role(this, 'ApiGatewayLoggingRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      description: 'Role for API Gateway to write logs to CloudWatch'
    });

    // CloudWatch Logs 쓰기 권한 부여
    apiGatewayLoggingRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams'
      ],
      resources: [
        `${logGroup.logGroupArn}`,
        `${logGroup.logGroupArn}:*`
      ]
    }));

    // Create IAM role for API Gateway
    const apiRole = new iam.Role(scope, 'ApiGatewayRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      description: 'Role for API Gateway to invoke Step Functions'
    });

    // Add permission to invoke Step Functions
    apiRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['states:StartExecution'],
      resources: [props.stateMachine.stateMachineArn]
    }));

    // Create webhook endpoint
    const webhook = this.api.root.addResource('webhook');

    // Add POST method
    webhook.addMethod('POST', new apigateway.Integration({
      type: apigateway.IntegrationType.AWS,
      integrationHttpMethod: 'POST',
      uri: `arn:aws:apigateway:${cdk.Stack.of(scope).region}:states:action/StartExecution`,
      options: {
        credentialsRole: apiRole,
        requestTemplates: {
          'application/json': `
          #set($body = $input.body)
          #set($cleaned = $body.replace("'", ""))
          {
            "input": "{\\\"body\\\": $util.escapeJavaScript($cleaned)}",
            "stateMachineArn": "${props.stateMachine.stateMachineArn}"
          }`
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': JSON.stringify({
                executionArn: "$util.parseJson($input.body).executionArn",
                startDate: "$util.parseJson($input.body).startDate"
              })
            }
          }
        ]
      }
    }), {
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL
          }
        }
      ]
    });

    // 추가 로그 설정을 위한 스테이지 설정
    const stage = this.api.deploymentStage as apigateway.Stage;
    const cfnStage = stage.node.defaultChild as apigateway.CfnStage;
    
    // 로그 설정 활성화
    cfnStage.addPropertyOverride('MethodSettings', [{
      HttpMethod: '*',
      ResourcePath: '/*',
      LoggingLevel: 'INFO',
      DataTraceEnabled: true,
      MetricsEnabled: true
    }]);

    // Output API URL
    new cdk.CfnOutput(scope, 'WebhookUrl', {
      value: `${this.api.url}webhook`,
      description: 'Webhook URL for PR Review Bot'
    });

    // Output Log Group ARN
    new cdk.CfnOutput(scope, 'ApiGatewayLogGroup', {
      value: logGroup.logGroupArn,
      description: 'API Gateway Log Group ARN'
    });
  }
}