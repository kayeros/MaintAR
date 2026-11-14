namespace MaintARBackend.Models;

/// <summary>Работа, которую инженер выполнил с узлом и зафиксировал в системе.</summary>
public class MaintenanceRecord
{
    public int Id { get; set; }

    public int ComponentId { get; set; }

    public Component Component { get; set; } = null!;

    public int UserId { get; set; }

    public User User { get; set; } = null!;

    public MaintenanceType Type { get; set; }

    public DateTime Date { get; set; }

    public string? Comment { get; set; }
}
