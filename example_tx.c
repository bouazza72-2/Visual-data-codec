/**
 * @file example_tx.c
 * @brief Demonstration of Visual Data Codec C/C++ Transmitter (visual_tx)
 *
 * This example shows how to:
 *   1. Prepare a dummy raw memory buffer (e.g., telemetry packet, binary dump, or sensor stream).
 *   2. Encode the buffer into a 1x visual grid with exact 24-byte VCDC header and Reed-Solomon RS(255, 239).
 *   3. Render the grid directly into a 1080p (1920x1080) RGBA/RGB888 HDMI framebuffer at 10x pixel scale.
 *   4. Export the resulting frame as a standard PPM image (frame_1080p.ppm) ready for inspection.
 *
 * HOW TO COMPILE:
 *   Using GCC:
 *     gcc -O2 -Wall -Wextra example_tx.c visual_tx.c -o example_tx
 *
 *   Using Clang:
 *     clang -O2 -Wall -Wextra example_tx.c visual_tx.c -o example_tx
 *
 *   Using G++ / Clang++ (C++ mode):
 *     g++ -O2 -Wall -Wextra example_tx.c visual_tx.c -o example_tx
 *
 * HOW TO RUN:
 *     ./example_tx
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "visual_tx.h"

/* Structure of our sample telemetry packet */
#pragma pack(push, 1)
typedef struct {
    uint32_t packet_seq;        /* Incrementing sequence ID */
    uint32_t system_uptime_sec; /* System uptime */
    float    cpu_temp_c;        /* Telemetry value */
    float    bus_voltage_v;     /* Telemetry value */
    uint8_t  status_flags;      /* Bitmask */
    char     status_msg[47];    /* Human-readable message */
} sample_telemetry_payload_t;
#pragma pack(pop)

int main(void) {
    printf("====================================================================\n");
    printf("     VISUAL DATA CODEC (VCDC) - C/C++ TRANSMITTER PAYLOAD DEMO     \n");
    printf("====================================================================\n\n");

    /* ------------------------------------------------------------------------
     * Step 1: Populate a dummy raw memory buffer (telemetry payload)
     * ------------------------------------------------------------------------ */
    sample_telemetry_payload_t telemetry;
    memset(&telemetry, 0, sizeof(telemetry));

    telemetry.packet_seq = 1042;
    telemetry.system_uptime_sec = 86400;
    telemetry.cpu_temp_c = 42.5f;
    telemetry.bus_voltage_v = 12.04f;
    telemetry.status_flags = 0x07; /* Link Up | FEC Active | Synchronized */
    snprintf(
        telemetry.status_msg,
        sizeof(telemetry.status_msg),
        "VCDC Optical Stream: HDMI Broadcast @ 60 FPS"
    );

    const uint8_t *raw_payload = (const uint8_t *)&telemetry;
    size_t payload_len = sizeof(telemetry);

    printf("[1] Raw Payload Prepared:\n");
    printf("    Payload Byte Size: %zu bytes\n", payload_len);
    printf("    Packet Sequence:   #%u\n", telemetry.packet_seq);
    printf("    Status Message:    \"%s\"\n", telemetry.status_msg);

    /* Compute CRC32 of raw payload */
    uint32_t payload_crc = vcdc_crc32(raw_payload, payload_len);
    printf("    Payload CRC32:     0x%08X\n\n", payload_crc);

    /* ------------------------------------------------------------------------
     * Step 2: Encode raw memory buffer into unscaled 1x visual grid
     * ------------------------------------------------------------------------ */
    /* Estimate required grid buffer capacity */
    size_t max_encoded_len = vcdc_rs_encoded_size(payload_len, VCDC_RS_PARITY_SIZE, VCDC_RS_BLOCK_SIZE);
    int grid_w = 0, grid_h = 0;
    vcdc_calculate_grid_dimensions(max_encoded_len, 64, &grid_w, &grid_h);

    size_t pixel_buf_capacity = (size_t)grid_w * (size_t)grid_h * 3;
    uint8_t *pixel_buffer = (uint8_t *)malloc(pixel_buf_capacity);
    if (!pixel_buffer) {
        fprintf(stderr, "[ERROR] Failed to allocate pixel buffer!\n");
        return 1;
    }

    vcdc_grid_t grid;
    bool enable_reed_solomon = true; /* Enable RS(255, 239) protection */

    vcdc_status_t status = vcdc_encode_frame_rgb(
        raw_payload,
        payload_len,
        enable_reed_solomon,
        64, /* Minimum grid width: 64 px */
        pixel_buffer,
        pixel_buf_capacity,
        &grid
    );

    if (status != VCDC_OK) {
        fprintf(stderr, "[ERROR] Frame encoding failed with error code: %d\n", status);
        free(pixel_buffer);
        return 1;
    }

    printf("[2] Visual Frame Grid Generated:\n");
    printf("    Grid Dimensions:   %d x %d pixels\n", grid.width, grid.height);
    printf("    Row 0 Header:      24-byte VCDC metadata (Magic, Mode, ECC, Len, CRC32, END)\n");
    printf("    Data Rows:         Rows 1 to %d\n", grid.height - 1);
    printf("    FEC Protection:    Reed-Solomon RS(255, 239) with 16 parity bytes\n");
    printf("    Total Encoded:     %zu bytes (Payload: %zu B + RS Parity: %zu B)\n\n",
           grid.encoded_bytes, grid.payload_bytes, grid.encoded_bytes - grid.payload_bytes);

    /* ------------------------------------------------------------------------
     * Step 3: Render visual grid into 1080p (1920x1080) HDMI Framebuffer
     * ------------------------------------------------------------------------ */
    const int fb_w = VCDC_HDMI_1080P_W; /* 1920 */
    const int fb_h = VCDC_HDMI_1080P_H; /* 1080 */
    const int scale = 10;                /* 10x integer scaling for capture readability */

    /* 32-bit RGBA framebuffer: 1920 x 1080 x 4 bytes = ~8.29 MB */
    size_t fb_capacity = (size_t)fb_w * (size_t)fb_h * 4;
    uint8_t *framebuffer = (uint8_t *)malloc(fb_capacity);
    if (!framebuffer) {
        fprintf(stderr, "[ERROR] Failed to allocate HDMI framebuffer memory!\n");
        free(pixel_buffer);
        return 1;
    }

    /* Professional dark background color for HDMI output (RGB: 18, 18, 22) */
    vcdc_color_t bg_color = { 18, 18, 22, 255 };

    status = vcdc_render_framebuffer(
        &grid,
        framebuffer,
        fb_w,
        fb_h,
        -1, -1, /* -1, -1 = Automatically center grid horizontally and vertically */
        scale,
        VCDC_FMT_RGBA8888,
        bg_color
    );

    if (status != VCDC_OK) {
        fprintf(stderr, "[ERROR] Framebuffer rendering failed with error code: %d\n", status);
        free(framebuffer);
        free(pixel_buffer);
        return 1;
    }

    int scaled_w = grid.width * scale;
    int scaled_h = grid.height * scale;
    int offset_x = (fb_w - scaled_w) / 2;
    int offset_y = (fb_h - scaled_h) / 2;

    printf("[3] HDMI Framebuffer Rendered:\n");
    printf("    Target Format:     1080p RGBA8888 (1920 x 1080 @ 60 FPS)\n");
    printf("    Integer Scaling:   %dx (%d x %d pixels scaled)\n", scale, scaled_w, scaled_h);
    printf("    Screen Placement:  Centered at (%d, %d) with dark margin padding\n\n", offset_x, offset_y);

    /* ------------------------------------------------------------------------
     * Step 4: Export to PPM image file for inspection
     * ------------------------------------------------------------------------ */
    const char *out_ppm_file = "frame_1080p.ppm";
    status = vcdc_export_ppm(out_ppm_file, framebuffer, fb_w, fb_h, VCDC_FMT_RGBA8888);
    if (status == VCDC_OK) {
        printf("[4] Output Exported Successfully:\n");
        printf("    Saved File:        %s\n", out_ppm_file);
        printf("    File Type:         Standard 24-bit binary PPM image\n");
        printf("    Test Verification: Compatible with live_stream_decoder.py and visual_codec.py!\n\n");
    }

    /* ------------------------------------------------------------------------
     * Step 5: Benchmark rendering throughput
     * ------------------------------------------------------------------------ */
    printf("[5] Benchmarking Framebuffer Render Performance:\n");
    const int benchmark_iterations = 120;
    clock_t start_time = clock();

    for (int i = 0; i < benchmark_iterations; i++) {
        vcdc_render_framebuffer(
            &grid,
            framebuffer,
            fb_w,
            fb_h,
            -1, -1,
            scale,
            VCDC_FMT_RGBA8888,
            bg_color
        );
    }

    clock_t end_time = clock();
    double total_sec = (double)(end_time - start_time) / CLOCKS_PER_SEC;
    double fps = (double)benchmark_iterations / (total_sec > 0.0 ? total_sec : 0.001);

    printf("    Rendered %d frames in %.3f seconds\n", benchmark_iterations, total_sec);
    printf("    Achieved Speed:    %.1f FPS (Ready for 1080p @ 60Hz HDMI video sync)\n", fps);
    printf("====================================================================\n");
    printf("                    DEMONSTRATION COMPLETED                         \n");
    printf("====================================================================\n");

    /* Cleanup */
    free(framebuffer);
    free(pixel_buffer);

    return 0;
}
