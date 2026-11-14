using MaintARBackend.Models;

namespace MaintARBackend.Context;

/// <summary>
/// Содержимое справочников. Источник: документ «Типы дефектов промышленного оборудования».
/// Номера Id менять нельзя: на них ссылаются данные в базе.
/// </summary>
public static class SeedData
{
    private const int Motors = 1;
    private const int Valves = 2;
    private const int Transformers = 3;
    private const int Conveyors = 4;
    private const int HeatExchangers = 5;
    private const int Compressors = 6;

    public static readonly EquipmentType[] EquipmentTypes =
    [
        new() { Id = Motors, Name = "Электродвигатели и электроприводы" },
        new() { Id = Valves, Name = "Запорная и регулирующая арматура" },
        new() { Id = Transformers, Name = "Трансформаторы и распределительные устройства" },
        new() { Id = Conveyors, Name = "Конвейерные системы и ленточные транспортеры" },
        new() { Id = HeatExchangers, Name = "Теплообменники и аппараты воздушного охлаждения" },
        new() { Id = Compressors, Name = "Компрессорное оборудование и пневмосистемы" },
    ];

    public static readonly DefectType[] DefectTypes =
    [
        // 1. Электродвигатели и электроприводы
        new()
        {
            Id = 1, EquipmentTypeId = Motors, Code = "MOTOR_CABLE_INSULATION",
            Name = "Повреждение изоляции кабелей",
            Description = "Визуальные трещины, надрывы, оплавление или «обугливание» внешней оболочки кабеля, оголение медных жил или экранирующей оплетки."
        },
        new()
        {
            Id = 2, EquipmentTypeId = Motors, Code = "MOTOR_COOLING_FINS",
            Name = "Деформация ребер охлаждения",
            Description = "Погнутые, сломанные или отсутствующие участки алюминиевых ребер на корпусе двигателя (часто из-за механических ударов при транспортировке или монтаже)."
        },
        new()
        {
            Id = 3, EquipmentTypeId = Motors, Code = "MOTOR_OVERHEATING",
            Name = "Следы перегрева (побежалость)",
            Description = "Локальное изменение цвета краски корпуса с заводского (обычно синего или серого) на бурый, желтоватый или радужно-синий в зоне подшипниковых щитов или клеммной коробки."
        },
        new()
        {
            Id = 4, EquipmentTypeId = Motors, Code = "MOTOR_NO_GROUNDING",
            Name = "Отсутствие заземления",
            Description = "Визуальное отсутствие или обрыв желто-зеленого провода заземления на корпусе или болте заземления."
        },

        // 2. Запорная и регулирующая арматура
        new()
        {
            Id = 5, EquipmentTypeId = Valves, Code = "VALVE_STEM_SEAL_LEAK",
            Name = "Протечка через сальник штока",
            Description = "Капли жидкости, кристаллизация продукта (соли, белый налет) или свежее влажное пятно непосредственно под штоком или на уплотнительной гайке."
        },
        new()
        {
            Id = 6, EquipmentTypeId = Valves, Code = "VALVE_HANDWHEEL",
            Name = "Повреждение или отсутствие маховика/рукоятки",
            Description = "Трещины на чугунном маховике, отсутствие шпонки, или полная замена штатного маховика на подручные средства (например, газовый ключ, надетый на шток)."
        },
        new()
        {
            Id = 7, EquipmentTypeId = Valves, Code = "VALVE_FLANGE_CORROSION",
            Name = "Коррозия фланцевых соединений",
            Description = "Ржавые подтеки, идущие от болтов фланца вниз по корпусу, или вздутие краски в месте стыка фланцев (признак внутренней коррозии и начала свища)."
        },
        new()
        {
            Id = 8, EquipmentTypeId = Valves, Code = "VALVE_INDICATOR_MISMATCH",
            Name = "Несоответствие положения индикатора",
            Description = "Визуальный разрыв между положением штока (выдвинут/задвинут) и указателем на маховике или визуальном индикаторе (для арматуры с визуальным контролем)."
        },

        // 3. Трансформаторы и распределительные устройства
        new()
        {
            Id = 9, EquipmentTypeId = Transformers, Code = "TRANSFORMER_SILICA_GEL",
            Name = "Насыщение силикагеля",
            Description = "Изменение цвета гранул в воздухоосушителе (сапуне) с синего или оранжевого на розовый или белый (визуальный признак того, что силикагель впитал влагу и требует замены или регенерации)."
        },
        new()
        {
            Id = 10, EquipmentTypeId = Transformers, Code = "TRANSFORMER_INSULATORS",
            Name = "Дефекты изоляторов",
            Description = "Трещины, сколы, глубокие царапины или следы электрической дуги (черные извилистые линии) на фарфоровых или полимерных изоляторах и вводах."
        },
        new()
        {
            Id = 11, EquipmentTypeId = Transformers, Code = "TRANSFORMER_OIL_LEAK",
            Name = "Масляные подтеки на баке",
            Description = "Темные, маслянистые дорожки, стекающие от прокладок крышки бака, фланцев расширителя или сливных кранов, часто с налипшей на них пылью и грязью."
        },
        new()
        {
            Id = 12, EquipmentTypeId = Transformers, Code = "TRANSFORMER_GROUNDING_CORROSION",
            Name = "Коррозия заземляющего контура",
            Description = "Полное разрушение или сильное истончение полосы заземления, идущей к нейтрали или корпусу."
        },

        // 4. Конвейерные системы и ленточные транспортеры
        new()
        {
            Id = 13, EquipmentTypeId = Conveyors, Code = "CONVEYOR_BELT_DAMAGE",
            Name = "Разрушение ленты",
            Description = "Продольные разрывы, поперечные трещины, отслоение верхнего резинового слоя (до корда) или вырванные куски кромки."
        },
        new()
        {
            Id = 14, EquipmentTypeId = Conveyors, Code = "CONVEYOR_ROLLER_WEAR",
            Name = "Заклинивание или износ роликов",
            Description = "Появление плоских «лысых» пятен на поверхности ролика (признак того, что он не вращается, а лента трется о него), отсутствие защитных крышек на торцах роликов."
        },
        new()
        {
            Id = 15, EquipmentTypeId = Conveyors, Code = "CONVEYOR_BELT_MISALIGNMENT",
            Name = "Сход ленты (нецентровка)",
            Description = "Визуальное смещение полотна ленты относительно центра роликоопор, трение края ленты о металлоконструкцию эстакады."
        },
        new()
        {
            Id = 16, EquipmentTypeId = Conveyors, Code = "CONVEYOR_MATERIAL_BUILDUP",
            Name = "Налипание и завалы",
            Description = "Скопление транспортируемого материала под конвейером, на обратной ветви ленты или на барабанах, что визуально меняет геометрию узлов."
        },

        // 5. Теплообменники и аппараты воздушного охлаждения
        new()
        {
            Id = 17, EquipmentTypeId = HeatExchangers, Code = "EXCHANGER_FIN_DEFORMATION",
            Name = "Деформация оребрения",
            Description = "Массовый загиб, сминание или отсутствие алюминиевых пластин (ребер) теплообмена, что визуально создает «провалы» или темные пятна в структуре блока."
        },
        new()
        {
            Id = 18, EquipmentTypeId = HeatExchangers, Code = "EXCHANGER_INSULATION_DAMAGE",
            Name = "Повреждение изоляции",
            Description = "Порванная, промокшая (темные пятна), сползшая или полностью отсутствующая металлическая обечайка (кожух) на изолированных трубопроводах или корпусах аппаратов."
        },
        new()
        {
            Id = 19, EquipmentTypeId = HeatExchangers, Code = "EXCHANGER_FOULING",
            Name = "Биологические или минеральные обрастания",
            Description = "Белый солевой налет, зеленый мох или коричневые наросты на внешних патрубках, фланцах или в зонах возможного микрокаплепадения."
        },

        // 6. Компрессорное оборудование и пневмосистемы
        new()
        {
            Id = 20, EquipmentTypeId = Compressors, Code = "COMPRESSOR_FLEX_CONNECTION",
            Name = "Дефекты гибких соединений",
            Description = "Трещины, вздутия («грыжи»), перетирание до корда или видимые надрывы на резиновых вибровставках, рукавах высокого давления (РВД) и шлангах."
        },
        new()
        {
            Id = 21, EquipmentTypeId = Compressors, Code = "COMPRESSOR_DIRTY_COOLER",
            Name = "Загрязнение поверхностей теплообмена",
            Description = "Плотный слой пыли, грязи, пуха или масла на внешних ребрах интеркулеров и радиаторов, визуально напоминающий «войлок» (резко снижает эффективность охлаждения)."
        },
        new()
        {
            Id = 22, EquipmentTypeId = Compressors, Code = "COMPRESSOR_VIBRATION_MOUNT",
            Name = "Ослабление виброопор",
            Description = "Визуальный зазор между резиновой виброопорой и металлом, разрыв резины или выдавливание резиновой части из металлической обоймы."
        },
    ];
}
