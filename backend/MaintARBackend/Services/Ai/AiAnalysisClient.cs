using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using MaintARBackend.Models;

namespace MaintARBackend.Services.Ai;

// Клиент нашего ИИ-сервера.
// Контракт (если ИИ-сервер работает иначе — менять только этот файл):
//   POST {AiService:BaseUrl}/analyze, multipart/form-data:
//     photo   — файл изображения
//     context — JSON AiAnalysisRequest (оборудование, его узлы и возможные дефекты)
//   Ответ — JSON AiAnalysisResponse.
public interface IAiAnalysisClient
{
    Task<AiAnalysisResult> AnalyzeAsync(Stream photo, string fileName, string contentType,
        AiAnalysisRequest request, CancellationToken ct = default);
}

public class AiAnalysisRequest
{
    public int EquipmentId { get; set; }
    public required string EquipmentType { get; set; }
    public required string Model { get; set; }
    public List<AiComponentDto> Components { get; set; } = [];
    public List<AiDefectTypeDto> DefectTypes { get; set; } = [];
}

public class AiComponentDto
{
    public int Id { get; set; }
    public required string Name { get; set; }
}

public class AiDefectTypeDto
{
    public required string Code { get; set; }
    public required string Name { get; set; }
}

public class AiAnalysisResponse
{
    public List<AiFindingDto> Findings { get; set; } = [];
}

public class AiFindingDto
{
    public int ComponentId { get; set; }
    public string? DefectCode { get; set; }
    public FindingCategory Category { get; set; }
    public double? Confidence { get; set; }
    public string? Explanation { get; set; }
    public string? Recommendation { get; set; }
    public AiBoxDto? Box { get; set; }
}

public class AiBoxDto
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
}

public class AiAnalysisResult
{
    public required string RawJson { get; set; }
    public required AiAnalysisResponse Response { get; set; }
}

internal sealed class AiAnalysisClient : IAiAnalysisClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }
    };

    private readonly HttpClient _http;

    public AiAnalysisClient(HttpClient http)
    {
        _http = http;
    }

    public async Task<AiAnalysisResult> AnalyzeAsync(Stream photo, string fileName, string contentType,
        AiAnalysisRequest request, CancellationToken ct = default)
    {
        using var content = new MultipartFormDataContent();

        var photoContent = new StreamContent(photo);
        photoContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        content.Add(photoContent, "photo", fileName);
        content.Add(new StringContent(JsonSerializer.Serialize(request, JsonOptions)), "context");

        using var response = await _http.PostAsync("analyze", content, ct);
        var raw = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"AI server returned {(int)response.StatusCode}: {raw}");
        }

        var parsed = JsonSerializer.Deserialize<AiAnalysisResponse>(raw, JsonOptions)
                     ?? throw new InvalidOperationException("AI server returned empty response");

        return new AiAnalysisResult { RawJson = raw, Response = parsed };
    }
}
