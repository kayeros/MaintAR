using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace MaintARBackend.Migrations;

/// <inheritdoc />
public partial class _20261114102333_InitialCreate : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "EquipmentTypes",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_EquipmentTypes", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "Users",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                Email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                PasswordHash = table.Column<string>(type: "nvarchar(max)", nullable: false),
                UserName = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Users", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "DefectTypes",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                EquipmentTypeId = table.Column<int>(type: "int", nullable: false),
                Code = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                Description = table.Column<string>(type: "nvarchar(max)", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_DefectTypes", x => x.Id);
                table.ForeignKey(
                    name: "FK_DefectTypes_EquipmentTypes_EquipmentTypeId",
                    column: x => x.EquipmentTypeId,
                    principalTable: "EquipmentTypes",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "Equipment",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                EquipmentTypeId = table.Column<int>(type: "int", nullable: false),
                Code = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                SerialNumber = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                Model = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                Manufacturer = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                Location = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                Description = table.Column<string>(type: "nvarchar(max)", nullable: true),
                InstalledAt = table.Column<DateOnly>(type: "date", nullable: true),
                PhotoPath = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Equipment", x => x.Id);
                table.ForeignKey(
                    name: "FK_Equipment_EquipmentTypes_EquipmentTypeId",
                    column: x => x.EquipmentTypeId,
                    principalTable: "EquipmentTypes",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "Components",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                EquipmentId = table.Column<int>(type: "int", nullable: false),
                Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                ServiceLifeMonths = table.Column<int>(type: "int", nullable: true),
                InstalledAt = table.Column<DateOnly>(type: "date", nullable: true),
                LastReplacedAt = table.Column<DateOnly>(type: "date", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Components", x => x.Id);
                table.ForeignKey(
                    name: "FK_Components_Equipment_EquipmentId",
                    column: x => x.EquipmentId,
                    principalTable: "Equipment",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "Inspections",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                UserId = table.Column<int>(type: "int", nullable: false),
                EquipmentId = table.Column<int>(type: "int", nullable: false),
                CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                Status = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                IdentificationMethod = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                PhotoPath = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                RawAiResponse = table.Column<string>(type: "nvarchar(max)", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Inspections", x => x.Id);
                table.ForeignKey(
                    name: "FK_Inspections_Equipment_EquipmentId",
                    column: x => x.EquipmentId,
                    principalTable: "Equipment",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_Inspections_Users_UserId",
                    column: x => x.UserId,
                    principalTable: "Users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "MaintenanceRecords",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                ComponentId = table.Column<int>(type: "int", nullable: false),
                UserId = table.Column<int>(type: "int", nullable: false),
                Type = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                Date = table.Column<DateTime>(type: "datetime2", nullable: false),
                Comment = table.Column<string>(type: "nvarchar(max)", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_MaintenanceRecords", x => x.Id);
                table.ForeignKey(
                    name: "FK_MaintenanceRecords_Components_ComponentId",
                    column: x => x.ComponentId,
                    principalTable: "Components",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_MaintenanceRecords_Users_UserId",
                    column: x => x.UserId,
                    principalTable: "Users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "InspectionFindings",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                InspectionId = table.Column<int>(type: "int", nullable: false),
                ComponentId = table.Column<int>(type: "int", nullable: false),
                DefectTypeId = table.Column<int>(type: "int", nullable: true),
                Category = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                Confidence = table.Column<double>(type: "float", nullable: true),
                Explanation = table.Column<string>(type: "nvarchar(max)", nullable: true),
                Recommendation = table.Column<string>(type: "nvarchar(max)", nullable: true),
                BoxX = table.Column<double>(type: "float", nullable: true),
                BoxY = table.Column<double>(type: "float", nullable: true),
                BoxWidth = table.Column<double>(type: "float", nullable: true),
                BoxHeight = table.Column<double>(type: "float", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_InspectionFindings", x => x.Id);
                table.ForeignKey(
                    name: "FK_InspectionFindings_Components_ComponentId",
                    column: x => x.ComponentId,
                    principalTable: "Components",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_InspectionFindings_DefectTypes_DefectTypeId",
                    column: x => x.DefectTypeId,
                    principalTable: "DefectTypes",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_InspectionFindings_Inspections_InspectionId",
                    column: x => x.InspectionId,
                    principalTable: "Inspections",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.InsertData(
            table: "EquipmentTypes",
            columns: new[] { "Id", "Name" },
            values: new object[,]
            {
                { 1, "Электродвигатели и электроприводы" },
                { 2, "Запорная и регулирующая арматура" },
                { 3, "Трансформаторы и распределительные устройства" },
                { 4, "Конвейерные системы и ленточные транспортеры" },
                { 5, "Теплообменники и аппараты воздушного охлаждения" },
                { 6, "Компрессорное оборудование и пневмосистемы" }
            });

        migrationBuilder.InsertData(
            table: "DefectTypes",
            columns: new[] { "Id", "Code", "Description", "EquipmentTypeId", "Name" },
            values: new object[,]
            {
                { 1, "MOTOR_CABLE_INSULATION", "Визуальные трещины, надрывы, оплавление или «обугливание» внешней оболочки кабеля, оголение медных жил или экранирующей оплетки.", 1, "Повреждение изоляции кабелей" },
                { 2, "MOTOR_COOLING_FINS", "Погнутые, сломанные или отсутствующие участки алюминиевых ребер на корпусе двигателя (часто из-за механических ударов при транспортировке или монтаже).", 1, "Деформация ребер охлаждения" },
                { 3, "MOTOR_OVERHEATING", "Локальное изменение цвета краски корпуса с заводского (обычно синего или серого) на бурый, желтоватый или радужно-синий в зоне подшипниковых щитов или клеммной коробки.", 1, "Следы перегрева (побежалость)" },
                { 4, "MOTOR_NO_GROUNDING", "Визуальное отсутствие или обрыв желто-зеленого провода заземления на корпусе или болте заземления.", 1, "Отсутствие заземления" },
                { 5, "VALVE_STEM_SEAL_LEAK", "Капли жидкости, кристаллизация продукта (соли, белый налет) или свежее влажное пятно непосредственно под штоком или на уплотнительной гайке.", 2, "Протечка через сальник штока" },
                { 6, "VALVE_HANDWHEEL", "Трещины на чугунном маховике, отсутствие шпонки, или полная замена штатного маховика на подручные средства (например, газовый ключ, надетый на шток).", 2, "Повреждение или отсутствие маховика/рукоятки" },
                { 7, "VALVE_FLANGE_CORROSION", "Ржавые подтеки, идущие от болтов фланца вниз по корпусу, или вздутие краски в месте стыка фланцев (признак внутренней коррозии и начала свища).", 2, "Коррозия фланцевых соединений" },
                { 8, "VALVE_INDICATOR_MISMATCH", "Визуальный разрыв между положением штока (выдвинут/задвинут) и указателем на маховике или визуальном индикаторе (для арматуры с визуальным контролем).", 2, "Несоответствие положения индикатора" },
                { 9, "TRANSFORMER_SILICA_GEL", "Изменение цвета гранул в воздухоосушителе (сапуне) с синего или оранжевого на розовый или белый (визуальный признак того, что силикагель впитал влагу и требует замены или регенерации).", 3, "Насыщение силикагеля" },
                { 10, "TRANSFORMER_INSULATORS", "Трещины, сколы, глубокие царапины или следы электрической дуги (черные извилистые линии) на фарфоровых или полимерных изоляторах и вводах.", 3, "Дефекты изоляторов" },
                { 11, "TRANSFORMER_OIL_LEAK", "Темные, маслянистые дорожки, стекающие от прокладок крышки бака, фланцев расширителя или сливных кранов, часто с налипшей на них пылью и грязью.", 3, "Масляные подтеки на баке" },
                { 12, "TRANSFORMER_GROUNDING_CORROSION", "Полное разрушение или сильное истончение полосы заземления, идущей к нейтрали или корпусу.", 3, "Коррозия заземляющего контура" },
                { 13, "CONVEYOR_BELT_DAMAGE", "Продольные разрывы, поперечные трещины, отслоение верхнего резинового слоя (до корда) или вырванные куски кромки.", 4, "Разрушение ленты" },
                { 14, "CONVEYOR_ROLLER_WEAR", "Появление плоских «лысых» пятен на поверхности ролика (признак того, что он не вращается, а лента трется о него), отсутствие защитных крышек на торцах роликов.", 4, "Заклинивание или износ роликов" },
                { 15, "CONVEYOR_BELT_MISALIGNMENT", "Визуальное смещение полотна ленты относительно центра роликоопор, трение края ленты о металлоконструкцию эстакады.", 4, "Сход ленты (нецентровка)" },
                { 16, "CONVEYOR_MATERIAL_BUILDUP", "Скопление транспортируемого материала под конвейером, на обратной ветви ленты или на барабанах, что визуально меняет геометрию узлов.", 4, "Налипание и завалы" },
                { 17, "EXCHANGER_FIN_DEFORMATION", "Массовый загиб, сминание или отсутствие алюминиевых пластин (ребер) теплообмена, что визуально создает «провалы» или темные пятна в структуре блока.", 5, "Деформация оребрения" },
                { 18, "EXCHANGER_INSULATION_DAMAGE", "Порванная, промокшая (темные пятна), сползшая или полностью отсутствующая металлическая обечайка (кожух) на изолированных трубопроводах или корпусах аппаратов.", 5, "Повреждение изоляции" },
                { 19, "EXCHANGER_FOULING", "Белый солевой налет, зеленый мох или коричневые наросты на внешних патрубках, фланцах или в зонах возможного микрокаплепадения.", 5, "Биологические или минеральные обрастания" },
                { 20, "COMPRESSOR_FLEX_CONNECTION", "Трещины, вздутия («грыжи»), перетирание до корда или видимые надрывы на резиновых вибровставках, рукавах высокого давления (РВД) и шлангах.", 6, "Дефекты гибких соединений" },
                { 21, "COMPRESSOR_DIRTY_COOLER", "Плотный слой пыли, грязи, пуха или масла на внешних ребрах интеркулеров и радиаторов, визуально напоминающий «войлок» (резко снижает эффективность охлаждения).", 6, "Загрязнение поверхностей теплообмена" },
                { 22, "COMPRESSOR_VIBRATION_MOUNT", "Визуальный зазор между резиновой виброопорой и металлом, разрыв резины или выдавливание резиновой части из металлической обоймы.", 6, "Ослабление виброопор" }
            });

        migrationBuilder.CreateIndex(
            name: "IX_Components_EquipmentId",
            table: "Components",
            column: "EquipmentId");

        migrationBuilder.CreateIndex(
            name: "IX_DefectTypes_Code",
            table: "DefectTypes",
            column: "Code",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_DefectTypes_EquipmentTypeId",
            table: "DefectTypes",
            column: "EquipmentTypeId");

        migrationBuilder.CreateIndex(
            name: "IX_Equipment_Code",
            table: "Equipment",
            column: "Code",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_Equipment_EquipmentTypeId",
            table: "Equipment",
            column: "EquipmentTypeId");

        migrationBuilder.CreateIndex(
            name: "IX_Equipment_SerialNumber",
            table: "Equipment",
            column: "SerialNumber",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_InspectionFindings_ComponentId",
            table: "InspectionFindings",
            column: "ComponentId");

        migrationBuilder.CreateIndex(
            name: "IX_InspectionFindings_DefectTypeId",
            table: "InspectionFindings",
            column: "DefectTypeId");

        migrationBuilder.CreateIndex(
            name: "IX_InspectionFindings_InspectionId",
            table: "InspectionFindings",
            column: "InspectionId");

        migrationBuilder.CreateIndex(
            name: "IX_Inspections_EquipmentId",
            table: "Inspections",
            column: "EquipmentId");

        migrationBuilder.CreateIndex(
            name: "IX_Inspections_UserId",
            table: "Inspections",
            column: "UserId");

        migrationBuilder.CreateIndex(
            name: "IX_MaintenanceRecords_ComponentId",
            table: "MaintenanceRecords",
            column: "ComponentId");

        migrationBuilder.CreateIndex(
            name: "IX_MaintenanceRecords_UserId",
            table: "MaintenanceRecords",
            column: "UserId");

        migrationBuilder.CreateIndex(
            name: "IX_Users_Email",
            table: "Users",
            column: "Email",
            unique: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "InspectionFindings");

        migrationBuilder.DropTable(
            name: "MaintenanceRecords");

        migrationBuilder.DropTable(
            name: "DefectTypes");

        migrationBuilder.DropTable(
            name: "Inspections");

        migrationBuilder.DropTable(
            name: "Components");

        migrationBuilder.DropTable(
            name: "Users");

        migrationBuilder.DropTable(
            name: "Equipment");

        migrationBuilder.DropTable(
            name: "EquipmentTypes");
    }
}
