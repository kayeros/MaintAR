using Microsoft.EntityFrameworkCore;
using MaintARBackend.Models;

namespace MaintARBackend.Context;

// Тестовое оборудование для разработки. Запускается только в Development и только если таблица Equipment пустая.
// Три варианта для проверки /api/Equipment/identify:
//   MOTOR-001  (SN-M-1001) — есть дефекты
//   VALVE-001  (SN-V-2001) — всё в порядке
//   PUMP-001   (SN-P-4001) — ещё не проверялось (насосный агрегат)
public static class DevDataSeeder
{
    private const int Motors = 1;
    private const int Valves = 2;
    private const int Transformers = 3;

    // На этот аккаунт записываются тестовые проверки, чтобы они были видны в /api/Inspections/my.
    private const string OwnerEmail = "pulat2007@mail.ru";
    private const string InspectorEmail = "inspector@test.local";

    // Демо-учётка из README: логин demo / пароль demo12345.
    // Фронт превращает короткий логин без «@» в demo@maintar.local (src/api.js, toEmail).
    private const string DemoEmail = "demo@maintar.local";
    private const string DemoPassword = "demo12345";

    // Фото из папки «Кейс», лежат в wwwroot/seed и попадают в репозиторий.
    private const string MotorPhoto = "/seed/equipment/motor-001.jpg";
    private const string ValvePhoto = "/seed/equipment/valve-001.jpg";
    private const string PumpPhoto = "/seed/equipment/pump-001.jpg";
    private const string MotorGeneralInspectionPhoto = "/seed/inspections/motor-001-general.jpg";
    private const string MotorCableInspectionPhoto = "/seed/inspections/motor-001-cable.jpg";
    private const string ValveGeneralInspectionPhoto = "/seed/inspections/valve-001-general.jpg";

    private const string PumpTypeName = "Насосные агрегаты";

    public static async Task SeedAsync(AppDbContext db)
    {
        await EnsureDemoUserAsync(db);

        var pumpTypeId = await EnsurePumpTypeAsync(db);

        if (await db.Equipment.AnyAsync())
        {
            await MoveInspectionsToOwnerAsync(db);
            await EnsureCatalogAsync(db, pumpTypeId);
            return;
        }

        // Проверки пишем на владельца, если он уже зарегистрирован, иначе — на служебного инспектора.
        // Войти под инспектором нельзя — хеш пароля пустой.
        var inspector = await db.Users.FirstOrDefaultAsync(u => u.Email == OwnerEmail)
                        ?? await db.Users.FirstOrDefaultAsync(u => u.Email == InspectorEmail);
        if (inspector == null)
        {
            inspector = new User
            {
                Email = InspectorEmail,
                UserName = "Тестовый инспектор",
                PasswordHash = "!",
                IsEmailVerified = true
            };
            db.Users.Add(inspector);
        }

        var motorStator = new Component { Name = "Статор", ServiceLifeMonths = 120 };
        var motorCable = new Component { Name = "Кабельный ввод", ServiceLifeMonths = 60 };
        var motorFan = new Component { Name = "Крыльчатка охлаждения", ServiceLifeMonths = 48 };

        var motor = new Equipment
        {
            EquipmentTypeId = Motors,
            Code = "MOTOR-001",
            SerialNumber = "SN-M-1001",
            Name = "Электродвигатель насоса №1",
            Model = "АИР 132 M4",
            Manufacturer = "Владимирский электромоторный завод",
            Location = "Цех 1, насосная станция",
            InstalledAt = new DateOnly(2021, 3, 15),
            PhotoPath = MotorPhoto,
            Components = [motorStator, motorCable, motorFan]
        };

        var valveBody = new Component { Name = "Корпус задвижки", ServiceLifeMonths = 240 };
        var valveStem = new Component { Name = "Шток с сальником", ServiceLifeMonths = 36 };

        var valve = new Equipment
        {
            EquipmentTypeId = Valves,
            Code = "VALVE-001",
            SerialNumber = "SN-V-2001",
            Name = "Задвижка на линии подачи",
            Model = "30с41нж DN100",
            Manufacturer = "Благовещенский арматурный завод",
            Location = "Цех 1, линия подачи воды",
            InstalledAt = new DateOnly(2022, 7, 1),
            PhotoPath = ValvePhoto,
            Components = [valveBody, valveStem]
        };

        // Насосный агрегат — ещё не проверялся.
        db.Equipment.AddRange(motor, valve, CreatePump(pumpTypeId));

        // Двигатель: старый осмотр без проблем и свежий с дефектами — в отчёт попадёт свежий.
        db.Inspections.Add(new Inspection
        {
            User = inspector,
            Equipment = motor,
            CreatedAt = DateTime.UtcNow.AddDays(-30),
            PhotoPath = MotorGeneralInspectionPhoto,
            Status = InspectionStatus.Completed,
            IdentificationMethod = IdentificationMethod.QrCode,
            Findings =
            [
                new InspectionFinding { Component = motorStator, Category = FindingCategory.NoVisibleProblems, Confidence = 0.95 }
            ]
        });

        db.Inspections.Add(new Inspection
        {
            User = inspector,
            Equipment = motor,
            CreatedAt = DateTime.UtcNow.AddDays(-1),
            PhotoPath = MotorCableInspectionPhoto,
            Status = InspectionStatus.Completed,
            IdentificationMethod = IdentificationMethod.QrCode,
            Findings =
            [
                new InspectionFinding
                {
                    Component = motorCable,
                    DefectTypeId = 1, // MOTOR_CABLE_INSULATION
                    Category = FindingCategory.PossibleDefect,
                    Confidence = 0.87,
                    Explanation = "На кабеле у ввода видны трещины и оголённые участки изоляции",
                    Recommendation = "Обесточить двигатель и заменить кабель"
                },
                new InspectionFinding
                {
                    Component = motorFan,
                    DefectTypeId = 2, // MOTOR_COOLING_FINS
                    Category = FindingCategory.CheckRecommended,
                    Confidence = 0.64,
                    Explanation = "Несколько рёбер охлаждения выглядят погнутыми",
                    Recommendation = "Проверить рёбра при следующем обслуживании"
                },
                new InspectionFinding
                {
                    Component = motorStator,
                    Category = FindingCategory.NoVisibleProblems,
                    Confidence = 0.92
                }
            ]
        });

        // Задвижка: осмотр без проблем.
        db.Inspections.Add(new Inspection
        {
            User = inspector,
            Equipment = valve,
            CreatedAt = DateTime.UtcNow.AddDays(-3),
            PhotoPath = ValveGeneralInspectionPhoto,
            Status = InspectionStatus.Completed,
            IdentificationMethod = IdentificationMethod.SerialNumber,
            Findings =
            [
                new InspectionFinding { Component = valveBody, Category = FindingCategory.NoVisibleProblems, Confidence = 0.91 },
                new InspectionFinding { Component = valveStem, Category = FindingCategory.NoVisibleProblems, Confidence = 0.89 }
            ]
        });

        // Трансформатор — без осмотров.

        await db.SaveChangesAsync();
    }

    // Если данные уже были созданы на служебного инспектора, а владелец зарегистрировался позже — переносим проверки на него.
    private static Equipment CreatePump(int pumpTypeId) => new()
    {
        EquipmentTypeId = pumpTypeId,
        Code = "PUMP-001",
        SerialNumber = "SN-P-4001",
        Name = "Насосный агрегат №1",
        Model = "Консольный насос с электродвигателем на общей раме",
        Location = "Цех 1, насосная станция",
        InstalledAt = new DateOnly(2020, 5, 12),
        PhotoPath = PumpPhoto,
        Components =
        [
            new Component { Name = "Корпус насоса", ServiceLifeMonths = 180 },
            new Component { Name = "Торцевое уплотнение вала", ServiceLifeMonths = 24 },
            new Component { Name = "Соединительная муфта", ServiceLifeMonths = 48 },
            new Component { Name = "Фундаментная рама и крепёж", ServiceLifeMonths = 240 }
        ]
    };

    // Тип «Насосные агрегаты» и его дефекты. Коды подобраны под сопоставление классов ИИ (LEAK, CORROSION, MOUNT/BOLT).
    private static async Task<int> EnsurePumpTypeAsync(AppDbContext db)
    {
        var type = await db.EquipmentTypes.FirstOrDefaultAsync(t => t.Name == PumpTypeName);
        if (type == null)
        {
            type = new EquipmentType { Name = PumpTypeName };
            db.EquipmentTypes.Add(type);
            await db.SaveChangesAsync();
        }

        var defects = new (string Code, string Name, string Description)[]
        {
            ("PUMP_SEAL_LEAK", "Протечка через уплотнение вала", "Подтёки перекачиваемой жидкости в районе торцевого уплотнения или сальника."),
            ("PUMP_HOUSING_CORROSION", "Коррозия корпуса насоса", "Очаги ржавчины и отслоение покрытия на корпусе и фланцах."),
            ("PUMP_FOUNDATION_BOLT", "Ослабление или коррозия крепления к раме", "Ослабленные, отсутствующие или корродированные фундаментные болты."),
            ("PUMP_COUPLING_WEAR", "Износ соединительной муфты", "Износ эластичных элементов муфты, несоосность валов насоса и двигателя.")
        };

        foreach (var d in defects)
        {
            if (!await db.DefectTypes.AnyAsync(x => x.Code == d.Code))
            {
                db.DefectTypes.Add(new DefectType { EquipmentTypeId = type.Id, Code = d.Code, Name = d.Name, Description = d.Description });
            }
        }

        await db.SaveChangesAsync();
        return type.Id;
    }

    // Для базы, созданной раньше: проставить фото и добавить насос вместо трансформатора.
    private static async Task EnsureCatalogAsync(AppDbContext db, int pumpTypeId)
    {
        var photos = new Dictionary<string, string> { ["MOTOR-001"] = MotorPhoto, ["VALVE-001"] = ValvePhoto };
        foreach (var e in await db.Equipment.Where(e => photos.Keys.Contains(e.Code) && e.PhotoPath == null).ToListAsync())
        {
            e.PhotoPath = photos[e.Code];
        }

        // Осмотрам тестового оборудования без фото: с дефектами — снимок клеммной коробки, без — общий вид.
        var inspections = await db.Inspections
            .Include(i => i.Equipment)
            .Include(i => i.Findings)
            .Where(i => i.PhotoPath == null && (i.Equipment.Code == "MOTOR-001" || i.Equipment.Code == "VALVE-001"))
            .ToListAsync();
        foreach (var i in inspections)
        {
            var hasDefects = i.Findings.Any(f => f.Category != FindingCategory.NoVisibleProblems);
            i.PhotoPath = i.Equipment.Code == "VALVE-001"
                ? ValveGeneralInspectionPhoto
                : hasDefects ? MotorCableInspectionPhoto : MotorGeneralInspectionPhoto;
        }

        if (!await db.Equipment.AnyAsync(e => e.Code == "PUMP-001"))
        {
            db.Equipment.Add(CreatePump(pumpTypeId));
        }

        // Тестовый трансформатор убираем, только если по нему ничего не делали.
        var trans = await db.Equipment.Include(e => e.Components).FirstOrDefaultAsync(e => e.Code == "TRANS-001");
        if (trans != null
            && !await db.Inspections.AnyAsync(i => i.EquipmentId == trans.Id)
            && !await db.MaintenanceRecords.AnyAsync(m => m.Component.EquipmentId == trans.Id))
        {
            db.Components.RemoveRange(trans.Components);
            db.Equipment.Remove(trans);
        }

        await db.SaveChangesAsync();
    }

    // Создаётся при каждом запуске, если её нет, — работает на любой новой базе.
    private static async Task EnsureDemoUserAsync(AppDbContext db)
    {
        if (await db.Users.AnyAsync(u => u.Email == DemoEmail))
        {
            return;
        }

        var demo = new User
        {
            Email = DemoEmail,
            UserName = "demo",
            PasswordHash = string.Empty,
            IsEmailVerified = true
        };
        demo.PasswordHash = new Microsoft.AspNetCore.Identity.PasswordHasher<User>().HashPassword(demo, DemoPassword);

        db.Users.Add(demo);
        await db.SaveChangesAsync();
    }

    private static async Task MoveInspectionsToOwnerAsync(AppDbContext db)
    {
        var owner = await db.Users.FirstOrDefaultAsync(u => u.Email == OwnerEmail);
        if (owner == null)
        {
            return;
        }

        await db.Inspections
            .Where(i => i.User.Email == InspectorEmail)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.UserId, owner.Id));
    }
}
