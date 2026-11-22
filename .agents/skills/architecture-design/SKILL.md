---
name: architecture-design
description: "设计软件架构和架构图。用于梳理已有系统、设计新系统或复杂变更，以及选择结构、流程、时序、状态、数据、部署和验证视图。用 Archify 制作图。"
---

# 架构设计

## 工作步骤

1. **确定问题和视角。** 写清图要回答的问题及系统、模块或场景范围。说明图描述的是现状还是目标。现状图从相关代码、契约、配置、测试和运行证据中核对事实。目标图标出已确定的设计及影响设计的未决事项。
2. **选择图种。** 按下方索引选择能回答问题的图种，只读对应指南。需要多张图时，先确定共同边界和名称，再补充会影响实现或验证的细节。
3. **明确设计约束。** 按所选指南确定关键元素、关系、边界和异常条件。设计新系统或复杂任务时，用明确的模块、接口和约束拆分实现任务，为每项任务写出验收条件。涉及既有系统时，将拟改的边界与当前实现对照。
4. **用 Archify 制作图。** 按[架构图存放约定](../../../docs/architecture/INDEX.md#架构图的生命周期与存放)确定产物目录。阅读同级 [archify Skill](../archify/SKILL.md)，按其类型路由、模型格式和交付步骤制作并验证图。正式 UML、BPMN 和机器可读契约按相应标准保存源文件并使用适用工具验证，Archify 用于生成配套说明图。
5. **核对交付。** 确认图回答了原问题，关键关系和限制有依据，与关联图、契约和测试一致。按 Archify 实际执行的检查说明验证情况。新增或更新长期图时同步[长期架构图登记](../../../docs/architecture/INDEX.md#长期架构图登记)。

## 选图索引

以读者要回答的问题选择对应指南。结构问题按确认边界所需的层级选图。关注调用顺序时选时序图，关注合法状态迁移时选状态机图。矩阵、契约、场景表和 ADR 按各自形式编写，需要配图时用 Archify 制作。

| 要回答的问题 | 图或设计产物 |
| --- | --- |
| 用户怎么完成目标，首版包含哪些故事？ | [用户故事地图](references/templates/01-user-story-map.md) |
| 业务需要哪些稳定能力？ | [业务能力地图](references/templates/02-business-capability-map.md) |
| 业务发生了什么，由谁触发，哪里还存在分歧？ | [EventStorming 事件风暴图](references/templates/03-event-storming.md) |
| 不同业务模型的边界和集成关系是什么？ | [DDD 限界上下文图](references/templates/04-context-map.md) |
| 目标系统与哪些用户和外部系统交互？ | [C4 L1 系统上下文图](references/templates/05-c4-system-context.md) |
| 系统有哪些应用和数据存储？ | [C4 L2 容器图](references/templates/06-c4-container.md) |
| 某个容器内部有哪些组件，分别负责什么？ | [C4 L3 组件图](references/templates/07-c4-component.md) |
| 某个组件内部的关键代码单元如何组织？ | [C4 L4 代码级图](references/templates/08-c4-code.md) |
| 哪些代码模块可以相互依赖，方向是什么？ | [模块依赖图 / UML 包图](references/templates/09-module-dependency.md) |
| 类和接口的静态关系是什么？ | [UML 类图](references/templates/10-uml-class.md) |
| 组件提供或需要哪些接口和端口？ | [UML 组件与接口图](references/templates/11-uml-component-interface.md) |
| 哪些依赖形成循环或耦合簇？ | [DSM 设计结构矩阵](references/templates/12-design-structure-matrix.md) |
| 一次请求的消息顺序、返回和异常是什么？ | [UML 时序图](references/templates/13-uml-sequence.md) |
| 活动怎样分支、并行和汇合？ | [UML 活动图](references/templates/14-uml-activity.md) |
| 跨角色或组织的业务流程如何执行？ | [BPMN 业务流程图](references/templates/15-bpmn-process.md) |
| 一个对象有哪些状态，什么条件允许迁移？ | [状态机图](references/templates/16-state-machine.md) |
| 事件怎样发布、消费、重试和处理失败？ | [事件流与异步协作图](references/templates/17-event-flow.md) |
| 已定义的架构元素在一个场景中如何协作？ | [C4 动态视图](references/templates/18-c4-dynamic.md) |
| 数据实体的字段、键和基数是什么？ | [ERD 实体关系图](references/templates/19-erd.md) |
| 数据从哪里来，经过哪些处理和存储？ | [DFD 数据流图](references/templates/20-data-flow.md) |
| 对外 API 或消息有哪些精确承诺？ | [API / 消息契约](references/templates/21-api-message-contract.md) |
| 运行单元部署在哪些环境和节点？ | [部署图 / C4 部署视图](references/templates/22-deployment.md) |
| 数据跨过哪些信任边界，需要哪些控制？ | [威胁建模与信任边界图](references/templates/23-threat-model.md) |
| 某项需求关联哪些设计、实现和验收证据？ | [需求—设计—测试追踪图](references/templates/24-traceability.md) |
| 性能、可靠性等质量目标怎样验证？ | [质量属性场景表](references/templates/25-quality-attribute-scenarios.md) |
| 为什么采用某项架构决策，代价是什么？ | [ADR 架构决策记录](references/templates/26-adr.md) |
| 哪些架构规则需要检查，怎样检验？ | [架构规则与验证矩阵](references/templates/27-architecture-validation-matrix.md) |

## 通用设计规范

- **范围和元信息。** 一图解决一个主要问题。交代图名、图种、范围、视角、图例和依据。长期图补充状态、维护者和最近核对日期，按需关联需求、契约或 ADR。
- **节点与边界。** 选定抽象层级，使用项目术语和能定位职责的名称。在同一图层内保持节点粒度一致，标清相关的系统、业务、部署或信任边界。图过密时按场景或层级拆开。
- **关系语义。** 用方向和动词短语说明关系，涉及通信时注明适用的协议及同步或异步属性。按图例区分源码依赖、运行时调用、数据流和物理连接。使用正式记法时，按对应规范解释符号。
- **异常与约束。** 补齐会改变结果的失败分支、权限、守卫条件和不变量。把实现所依赖的规则写成可检验条件，按需要用静态依赖检查、契约测试、行为测试或人工评审验证。
- **一致性。** 相关图复用同一术语和标识。需求由正式规格维护，接口和数据由相应契约或 Schema 维护，决策理由由 ADR 保存。图链接对应来源。图和实现出现偏差时，先核对来源和状态，再记录需要修正的差异。
