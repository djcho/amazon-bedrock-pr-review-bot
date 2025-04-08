import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class NetworkConstruct extends Construct {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // VPC 생성 (2개의 AZ, 각 AZ마다 퍼블릭/프라이빗 서브넷)
    this.vpc = new ec2.Vpc(this, 'ReviewBotVPC', {
      maxAzs: 2,
      natGateways: 1, // 비용 최적화를 위해 1개의 NAT Gateway 사용
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        }
      ],
      gatewayEndpoints: {
        // S3 엔드포인트 추가 (Lambda가 S3에 액세스할 수 있도록)
        S3: {
          service: ec2.GatewayVpcEndpointAwsService.S3
        }
      }
    });

    // VPC 엔드포인트 추가 (Lambda가 Secrets Manager에 액세스할 수 있도록)
    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER
    });

    // VPC Flow Logs 활성화 (네트워크 트래픽 모니터링)
    new ec2.FlowLog(this, 'FlowLog', {
      resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
      trafficType: ec2.FlowLogTrafficType.ALL
    });

    // NAT Gateway EIP에 태그 추가 (식별 용이성)
    cdk.Tags.of(this.vpc).add('Name', 'ReviewBot-VPC');
    
    // 메트릭 경보 설정 (NAT Gateway 데이터 전송량 모니터링)
    const natGatewayMetric = new cdk.aws_cloudwatch.Metric({
      namespace: 'AWS/NATGateway',
      metricName: 'BytesOutToDestination',
      dimensionsMap: {
        // NAT Gateway ID는 런타임에 결정되므로 여기서는 지정할 수 없음
        // CloudFormation 템플릿 생성 시 자동으로 채워짐
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5)
    });

    new cdk.aws_cloudwatch.Alarm(this, 'NATGatewayDataTransferAlarm', {
      metric: natGatewayMetric,
      threshold: 5_000_000_000, // 5GB (한도 초과 방지)
      evaluationPeriods: 1,
      alarmDescription: 'NAT Gateway data transfer exceeds 5GB in 5 minutes',
      comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
    });
  }
} 