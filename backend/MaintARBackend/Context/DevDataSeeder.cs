using Microsoft.EntityFrameworkCore;
using MaintARBackend.Models;

namespace MaintARBackend.Context;

// Тестовое оборудование для разработки. Запускается только в Development и только если таблица Equipment пустая.
// Три варианта для проверки /api/Equipment/identify:
//   MOTOR-001  (SN-M-1001) — есть дефекты
//   VALVE-001  (SN-V-2001) — всё в порядке
//   TRANS-001  (SN-T-3001) — ещё не проверялось
public static class DevDataSeeder
{
    private const int Motors = 1;
    private const int Valves = 2;
    private const int Transformers = 3;

    // На этот аккаунт записываются тестовые проверки, чтобы они были видны в /api/Inspections/my.
    private const string OwnerEmail = "pulat2007@mail.ru";
    private const string InspectorEmail = "inspector@test.local";

    public static async Task SeedAsync(AppDbContext db)
    {
        if (await db.Equipment.AnyAsync())
        {
            await MoveInspectionsToOwnerAsync(db);
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
            Components = [valveBody, valveStem]
        };

        var transformer = new Equipment
        {
            EquipmentTypeId = Transformers,
            Code = "TRANS-001",
            SerialNumber = "SN-T-3001",
            Name = "Силовой трансформатор ТП-3",
            Model = "ТМГ-400/10",
            Manufacturer = "Минский электротехнический завод",
            Location = "Трансформаторная подстанция №3",
            InstalledAt = new DateOnly(2019, 11, 20),
            Components =
            [
                new Component { Name = "Бак с маслом", ServiceLifeMonths = 300 },
                new Component { Name = "Воздухоосушитель", ServiceLifeMonths = 24 }
            ]
        };

        db.Equipment.AddRange(motor, valve, transformer);

        // Двигатель: старый осмотр без проблем и свежий с дефектами — в отчёт попадёт свежий.
        db.Inspections.Add(new Inspection
        {
            User = inspector,
            Equipment = motor,
            CreatedAt = DateTime.UtcNow.AddDays(-30),
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
